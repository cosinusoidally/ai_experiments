# ============================================================
# PowerShell + MSHTML/JScript software framebuffer
#
# Improvements over the original:
#
#   * Proper Win32 application window + WndProc
#   * Window can be moved/resized/minimized normally
#   * No artificial 60 Hz limit
#   * Messages are drained before each frame
#   * No comma-separated framebuffer data
#   * No Split()
#   * No per-byte PowerShell conversion loop
#   * No ToCharArray() framebuffer allocation
#   * JScript packs framebuffer bytes into a binary UTF-16 BSTR
#   * One native bulk copy transfers that string into byte[]
#   * Framebuffer and GDI objects are reused
#
# The logical framebuffer is 400x300 and StretchDIBits scales
# it to the current client area.
# ============================================================


# ============================================================
# 1. Native Win32 + fast-copy helper
# ============================================================

$NativeSource = @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class Native
{
    // --------------------------------------------------------
    // Constants
    // --------------------------------------------------------

    public const uint CS_HREDRAW = 0x0002;
    public const uint CS_VREDRAW = 0x0001;

    public const uint WS_OVERLAPPEDWINDOW = 0x00CF0000;
    public const uint WS_VISIBLE          = 0x10000000;

    public const uint WM_DESTROY      = 0x0002;
    public const uint WM_CLOSE        = 0x0010;
    public const uint WM_ERASEBKGND   = 0x0014;
    public const uint WM_QUIT         = 0x0012;

    public const uint PM_REMOVE = 0x0001;

    public const uint DIB_RGB_COLORS = 0;
    public const uint SRCCOPY        = 0x00CC0020;

    public const int SW_SHOW = 5;

    public const int CW_USEDEFAULT =
        unchecked((int)0x80000000);


    // --------------------------------------------------------
    // Structures
    // --------------------------------------------------------

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int x;
        public int y;
    }


    [StructLayout(LayoutKind.Sequential)]
    public struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }


    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int left;
        public int top;
        public int right;
        public int bottom;
    }


    [StructLayout(
        LayoutKind.Sequential,
        CharSet = CharSet.Unicode
    )]
    public struct WNDCLASSEX
    {
        public uint cbSize;
        public uint style;
        public WndProc lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;

        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string lpszMenuName;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string lpszClassName;

        public IntPtr hIconSm;
    }


    // --------------------------------------------------------
    // Window procedure
    // --------------------------------------------------------

    public delegate IntPtr WndProc(
        IntPtr hwnd,
        uint msg,
        UIntPtr wParam,
        IntPtr lParam
    );


    // Important: keeps delegate alive for the lifetime
    // of the process.
    private static readonly WndProc wndProcDelegate =
        WindowProc;


    private const string WindowClassName =
        "PS_JScript_Framebuffer_Window";


    private static IntPtr WindowProc(
        IntPtr hwnd,
        uint msg,
        UIntPtr wParam,
        IntPtr lParam
    )
    {
        switch (msg)
        {
            case WM_CLOSE:
                DestroyWindow(hwnd);
                return IntPtr.Zero;


            case WM_DESTROY:
                PostQuitMessage(0);
                return IntPtr.Zero;


            // We draw the entire client area ourselves.
            // Suppress background erase to reduce flicker.
            case WM_ERASEBKGND:
                return new IntPtr(1);
        }

        return DefWindowProc(
            hwnd,
            msg,
            wParam,
            lParam
        );
    }


    // --------------------------------------------------------
    // Window creation helper
    // --------------------------------------------------------

    public static IntPtr CreateFramebufferWindow(
        string title,
        int clientWidth,
        int clientHeight
    )
    {
        IntPtr instance =
            GetModuleHandle(null);


        WNDCLASSEX wc =
            new WNDCLASSEX();

        wc.cbSize =
            (uint)Marshal.SizeOf(
                typeof(WNDCLASSEX)
            );

        wc.style =
            CS_HREDRAW |
            CS_VREDRAW;

        wc.lpfnWndProc =
            wndProcDelegate;

        wc.hInstance =
            instance;

        // IDC_ARROW
        wc.hCursor =
            LoadCursor(
                IntPtr.Zero,
                new IntPtr(32512)
            );

        // No automatic background brush.
        // Our renderer covers the client area.
        wc.hbrBackground =
            IntPtr.Zero;

        wc.lpszClassName =
            WindowClassName;


        ushort atom =
            RegisterClassEx(
                ref wc
            );


        if (atom == 0)
        {
            int error =
                Marshal.GetLastWin32Error();

            // ERROR_CLASS_ALREADY_EXISTS
            if (error != 1410)
                throw new Win32Exception(error);
        }


        uint style =
            WS_OVERLAPPEDWINDOW |
            WS_VISIBLE;


        // Convert desired CLIENT dimensions into
        // the necessary outer-window dimensions.
        RECT rect = new RECT();

        rect.left   = 0;
        rect.top    = 0;
        rect.right  = clientWidth;
        rect.bottom = clientHeight;


        if (!AdjustWindowRect(
            ref rect,
            style,
            false
        ))
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error()
            );
        }


        int outerWidth =
            rect.right -
            rect.left;

        int outerHeight =
            rect.bottom -
            rect.top;


        IntPtr hwnd =
            CreateWindowEx(
                0,
                WindowClassName,
                title,
                style,

                CW_USEDEFAULT,
                CW_USEDEFAULT,

                outerWidth,
                outerHeight,

                IntPtr.Zero,
                IntPtr.Zero,

                instance,
                IntPtr.Zero
            );


        if (hwnd == IntPtr.Zero)
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error()
            );
        }


        ShowWindow(
            hwnd,
            SW_SHOW
        );

        UpdateWindow(hwnd);

        return hwnd;
    }


    // --------------------------------------------------------
    // Fast framebuffer transfer
    //
    // JScript returns a BSTR/.NET String.
    //
    // Each UTF-16 character contains exactly two framebuffer
    // bytes. Pin the .NET string and copy its raw UTF-16 bytes
    // directly into the reusable byte[].
    //
    // No ToCharArray().
    // No per-byte loop.
    // --------------------------------------------------------

    public static void CopyStringBytes(
        string source,
        byte[] destination,
        int byteCount
    )
    {
        if (source == null)
            throw new ArgumentNullException("source");

        if (destination == null)
            throw new ArgumentNullException("destination");

        if (byteCount < 0)
            throw new ArgumentOutOfRangeException(
                "byteCount"
            );

        if (source.Length * 2 < byteCount)
            throw new ArgumentException(
                "Source string is too short."
            );

        if (destination.Length < byteCount)
            throw new ArgumentException(
                "Destination buffer is too small."
            );


        GCHandle handle =
            GCHandle.Alloc(
                source,
                GCHandleType.Pinned
            );

        try
        {
            IntPtr sourcePointer =
                handle.AddrOfPinnedObject();


            Marshal.Copy(
                sourcePointer,
                destination,
                0,
                byteCount
            );
        }
        finally
        {
            handle.Free();
        }
    }


    // --------------------------------------------------------
    // Win32 imports
    // --------------------------------------------------------

    [DllImport(
        "kernel32.dll",
        CharSet = CharSet.Unicode
    )]
    public static extern IntPtr GetModuleHandle(
        string lpModuleName
    );


    [DllImport(
        "user32.dll",
        CharSet = CharSet.Unicode,
        SetLastError = true
    )]
    public static extern ushort RegisterClassEx(
        ref WNDCLASSEX lpwcx
    );


    [DllImport(
        "user32.dll",
        CharSet = CharSet.Unicode,
        SetLastError = true
    )]
    public static extern IntPtr CreateWindowEx(
        uint dwExStyle,
        string lpClassName,
        string lpWindowName,
        uint dwStyle,

        int x,
        int y,
        int nWidth,
        int nHeight,

        IntPtr hWndParent,
        IntPtr hMenu,
        IntPtr hInstance,
        IntPtr lpParam
    );


    [DllImport(
        "user32.dll",
        CharSet = CharSet.Unicode
    )]
    public static extern IntPtr DefWindowProc(
        IntPtr hWnd,
        uint msg,
        UIntPtr wParam,
        IntPtr lParam
    );


    [DllImport(
        "user32.dll",
        SetLastError = true
    )]
    public static extern bool DestroyWindow(
        IntPtr hWnd
    );


    [DllImport("user32.dll")]
    public static extern void PostQuitMessage(
        int nExitCode
    );


    [DllImport(
        "user32.dll",
        SetLastError = true
    )]
    public static extern bool AdjustWindowRect(
        ref RECT lpRect,
        uint dwStyle,
        bool bMenu
    );


    [DllImport(
        "user32.dll"
    )]
    public static extern IntPtr LoadCursor(
        IntPtr hInstance,
        IntPtr lpCursorName
    );


    [DllImport("user32.dll")]
    public static extern bool ShowWindow(
        IntPtr hWnd,
        int nCmdShow
    );


    [DllImport("user32.dll")]
    public static extern bool UpdateWindow(
        IntPtr hWnd
    );


    [DllImport(
        "user32.dll",
        CharSet = CharSet.Unicode
    )]
    public static extern bool PeekMessage(
        out MSG lpMsg,
        IntPtr hWnd,
        uint wMsgFilterMin,
        uint wMsgFilterMax,
        uint wRemoveMsg
    );


    [DllImport("user32.dll")]
    public static extern bool TranslateMessage(
        ref MSG lpMsg
    );


    [DllImport(
        "user32.dll",
        CharSet = CharSet.Unicode
    )]
    public static extern IntPtr DispatchMessage(
        ref MSG lpMsg
    );


    [DllImport("user32.dll")]
    public static extern bool GetClientRect(
        IntPtr hWnd,
        out RECT lpRect
    );


    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(
        IntPtr hWnd
    );


    [DllImport("user32.dll")]
    public static extern int ReleaseDC(
        IntPtr hWnd,
        IntPtr hDC
    );


    [DllImport("gdi32.dll")]
    public static extern int StretchDIBits(
        IntPtr hdc,

        int xDest,
        int yDest,
        int DestWidth,
        int DestHeight,

        int xSrc,
        int ySrc,
        int SrcWidth,
        int SrcHeight,

        byte[] lpBits,
        byte[] lpBitsInfo,

        uint iUsage,
        uint dwRop
    );
}
"@

Add-Type -TypeDefinition $NativeSource


# ============================================================
# 2. Logical framebuffer configuration
# ============================================================

$Width  = 400
$Height = 300

$BytesPerPixel = 4

$PixelCount =
    $Width * $Height

$BufferSize =
    $PixelCount * $BytesPerPixel


# Reusable native/GDI framebuffer.
$RawBuffer =
    New-Object byte[] $BufferSize


# ============================================================
# 3. BITMAPINFOHEADER
# ============================================================

# BITMAPINFOHEADER itself is exactly 40 bytes.
$BitmapInfo =
    New-Object byte[] 40


# biSize = 40
[BitConverter]::GetBytes(
    [int]40
).CopyTo(
    $BitmapInfo,
    0
)


# biWidth
[BitConverter]::GetBytes(
    [int]$Width
).CopyTo(
    $BitmapInfo,
    4
)


# Negative height makes the DIB top-down.
[BitConverter]::GetBytes(
    [int]-$Height
).CopyTo(
    $BitmapInfo,
    8
)


# biPlanes = 1
[BitConverter]::GetBytes(
    [int16]1
).CopyTo(
    $BitmapInfo,
    12
)


# biBitCount = 32
[BitConverter]::GetBytes(
    [int16]32
).CopyTo(
    $BitmapInfo,
    14
)


# biCompression = BI_RGB = 0
[BitConverter]::GetBytes(
    [int]0
).CopyTo(
    $BitmapInfo,
    16
)


# ============================================================
# 4. Create the headless JScript engine
# ============================================================

$JSContext =
    New-Object -ComObject "htmlfile"


# ============================================================
# 5. JScript renderer
#
# Instead of returning:
#
#     "128,32,64,255,128,33,65,255,..."
#
# we return a BSTR whose UTF-16 bytes ARE the framebuffer.
#
#
# For each BGRA pixel:
#
#       B G R A
#
# create two UTF-16 code units:
#
#       char1 = B | (G << 8)
#       char2 = R | (A << 8)
#
#
# On little-endian Windows the actual bytes of the resulting
# UTF-16 string are therefore:
#
#       B G R A
#
# exactly as StretchDIBits expects.
# ============================================================

$JSCode = @"
var width  = $Width;
var height = $Height;

var pixelCount = width * height;

/*
    Two UTF-16 characters per pixel.

    This array itself is allocated once and reused.
*/
var packed = new Array(pixelCount * 2);


/*
    Some values don't change with X/Y, so cache them.

    b = 128
    a = 255
*/
var blue = 128;
var alphaHigh = 255 << 8;


function RenderFrame(frameIndex)
{
    var outIndex = 0;

    var frameByte =
        frameIndex & 255;


    for (var y = 0; y < height; ++y)
    {
        var g =
            (y + frameByte) & 255;

        /*
            First packed character is:

                low byte  = B
                high byte = G
        */
        var bg =
            blue | (g << 8);


        for (var x = 0; x < width; ++x)
        {
            var r =
                (x + frameByte) & 255;


            packed[outIndex++] =
                String.fromCharCode(bg);


            packed[outIndex++] =
                String.fromCharCode(
                    r | alphaHigh
                );
        }
    }


    /*
        This is the one unavoidable frame object crossing
        the MSHTML/COM boundary.

        It is BINARY data despite being represented as a BSTR.
    */
    return packed.join("");
}
"@


# Load the JScript code.
$JSContext.Script.execScript(
    $JSCode,
    "JScript"
)


# ============================================================
# 6. Create real Win32 window
# ============================================================

$hWnd =
    [Native]::CreateFramebufferWindow(
        "PowerShell + JScript Framebuffer",
        $Width,
        $Height
    )


if ($hWnd -eq [IntPtr]::Zero) {
    throw "Unable to create Win32 window."
}


# Hold the client DC for the life of this window.
#
# This avoids GetDC/ReleaseDC on every frame.
$hDC =
    [Native]::GetDC(
        $hWnd
    )


if ($hDC -eq [IntPtr]::Zero) {
    throw "GetDC failed."
}


# ============================================================
# 7. Reusable message/window structures
# ============================================================

$Msg =
    New-Object Native+MSG

$ClientRect =
    New-Object Native+RECT


$Running = $true
$Frame   = 0


Write-Host ""
Write-Host "Framebuffer window running."
Write-Host "Rendering is uncapped."
Write-Host "Close the native window to exit."
Write-Host ""


# ============================================================
# 8. Main loop
# ============================================================

try {

    while ($Running) {

        # ====================================================
        # A. Drain ALL pending Win32 messages before rendering.
        #
        # This keeps moving/resizing/closing responsive.
        # ====================================================

        while (
            [Native]::PeekMessage(
                [ref]$Msg,
                [IntPtr]::Zero,
                0,
                0,
                [Native]::PM_REMOVE
            )
        ) {

            if (
                $Msg.message -eq
                [Native]::WM_QUIT
            ) {
                $Running = $false
                break
            }


            [Native]::TranslateMessage(
                [ref]$Msg
            ) | Out-Null


            [Native]::DispatchMessage(
                [ref]$Msg
            ) | Out-Null
        }


        if (-not $Running) {
            break
        }


        # ====================================================
        # B. Execute renderer IN JScript.
        #
        # Do not call:
        #
        #     $JSContext.Script.RenderFrame(...)
        #
        # Dynamic functions injected with execScript are not
        # always exposed as COM members.
        #
        # Calling eval() keeps lookup inside JScript itself.
        # ====================================================

        [string]$PackedFrame =
            $JSContext.Script.eval(
                "RenderFrame($Frame)"
            )


        # Optional sanity check.
        #
        # Two framebuffer bytes are stored in every .NET char.
        $ExpectedCharacters =
            $BufferSize / 2


        if (
            $PackedFrame.Length -ne
            $ExpectedCharacters
        ) {
            throw (
                "Unexpected framebuffer length. " +
                "Expected $ExpectedCharacters characters, " +
                "received $($PackedFrame.Length)."
            )
        }


        # ====================================================
        # C. Bulk-copy the binary BSTR into byte[].
        #
        # This is one native copy.
        #
        # NO:
        #
        #   Split(',')
        #   byte parsing
        #   PowerShell framebuffer loop
        #   ToCharArray()
        # ====================================================

        [Native]::CopyStringBytes(
            $PackedFrame,
            $RawBuffer,
            $BufferSize
        )


        # ====================================================
        # D. Determine current drawable client size.
        #
        # When resized, the logical 400x300 framebuffer gets
        # scaled to the window.
        # ====================================================

        if (
            [Native]::GetClientRect(
                $hWnd,
                [ref]$ClientRect
            )
        ) {

            $ClientWidth =
                $ClientRect.right -
                $ClientRect.left


            $ClientHeight =
                $ClientRect.bottom -
                $ClientRect.top


            # Width/height become zero while minimized.
            if (
                $ClientWidth -gt 0 -and
                $ClientHeight -gt 0
            ) {

                # ============================================
                # E. Blit framebuffer into the client area.
                # ============================================

                [Native]::StretchDIBits(
                    $hDC,

                    # Destination
                    0,
                    0,
                    $ClientWidth,
                    $ClientHeight,

                    # Source logical framebuffer
                    0,
                    0,
                    $Width,
                    $Height,

                    $RawBuffer,
                    $BitmapInfo,

                    [Native]::DIB_RGB_COLORS,
                    [Native]::SRCCOPY

                ) | Out-Null
            }
        }


        # Wrap naturally; renderer only uses low 8 bits.
        $Frame++


        # ----------------------------------------------------
        # Deliberately NO Start-Sleep.
        #
        # The renderer runs as fast as the combination of
        #
        #     JScript
        #       ->
        #     COM BSTR
        #       ->
        #     memcpy
        #       ->
        #     StretchDIBits
        #
        # allows.
        #
        # Window messages are serviced before every frame.
        # ----------------------------------------------------
    }
}
finally {

    # ========================================================
    # 9. Cleanup
    # ========================================================

    if (
        $hDC -ne [IntPtr]::Zero -and
        $hWnd -ne [IntPtr]::Zero
    ) {
        [Native]::ReleaseDC(
            $hWnd,
            $hDC
        ) | Out-Null
    }


    if ($hWnd -ne [IntPtr]::Zero) {
        [Native]::DestroyWindow(
            $hWnd
        ) | Out-Null
    }


    if ($null -ne $JSContext) {

        [Runtime.InteropServices.Marshal]::
            FinalReleaseComObject(
                $JSContext
            ) | Out-Null

        $JSContext = $null
    }


    Write-Host ""
    Write-Host "Application closed."
}
