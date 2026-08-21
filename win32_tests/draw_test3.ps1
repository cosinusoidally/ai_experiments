# ============================================================
# Native Win32 window + MSHTML JScript framebuffer
#
# Main optimizations:
#   - Proper registered Win32 window class / WndProc
#   - No artificial 60 Hz sleep
#   - No CSV framebuffer transfer
#   - JS packs two bytes into each UTF-16 character
#   - PowerShell copies entire frame with Buffer.BlockCopy()
#   - Frame/DC/message objects reused
# ============================================================


# ------------------------------------------------------------
# 1. Native Win32 support
# ------------------------------------------------------------

$NativeSource = @"
using System;
using System.Runtime.InteropServices;

public static class Native
{
    public const uint CS_HREDRAW = 0x0002;
    public const uint CS_VREDRAW = 0x0001;

    public const uint WS_OVERLAPPEDWINDOW = 0x00CF0000;
    public const uint WS_VISIBLE          = 0x10000000;

    public const uint WM_CLOSE   = 0x0010;
    public const uint WM_DESTROY = 0x0002;
    public const uint WM_QUIT    = 0x0012;

    public const uint PM_REMOVE = 0x0001;

    public const int CW_USEDEFAULT = unchecked((int)0x80000000);

    public const uint DIB_RGB_COLORS = 0;
    public const uint SRCCOPY = 0x00CC0020;

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

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
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
        public string lpszMenuName;
        public string lpszClassName;
        public IntPtr hIconSm;
    }

    public delegate IntPtr WndProc(
        IntPtr hwnd,
        uint msg,
        UIntPtr wParam,
        IntPtr lParam
    );

    // Keep delegate alive for lifetime of application.
    private static readonly WndProc WindowProcDelegate = WindowProc;

    public static IntPtr CreateFramebufferWindow(
        string title,
        int clientWidth,
        int clientHeight
    )
    {
        IntPtr instance = GetModuleHandle(null);

        string className = "PowerShellFramebufferWindow";

        WNDCLASSEX wc = new WNDCLASSEX();
        wc.cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX));
        wc.style = CS_HREDRAW | CS_VREDRAW;
        wc.lpfnWndProc = WindowProcDelegate;
        wc.hInstance = instance;
        wc.hCursor = LoadCursor(IntPtr.Zero, new IntPtr(32512)); // IDC_ARROW
        wc.hbrBackground = new IntPtr(6); // COLOR_WINDOW + 1
        wc.lpszClassName = className;

        ushort atom = RegisterClassEx(ref wc);

        // ERROR_CLASS_ALREADY_EXISTS = 1410 is harmless.
        if (atom == 0)
        {
            int error = Marshal.GetLastWin32Error();

            if (error != 1410)
                throw new System.ComponentModel.Win32Exception(error);
        }

        uint style = WS_OVERLAPPEDWINDOW | WS_VISIBLE;

        RECT r = new RECT();
        r.left = 0;
        r.top = 0;
        r.right = clientWidth;
        r.bottom = clientHeight;

        AdjustWindowRect(ref r, style, false);

        int outerWidth  = r.right - r.left;
        int outerHeight = r.bottom - r.top;

        IntPtr hwnd = CreateWindowEx(
            0,
            className,
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
            int error = Marshal.GetLastWin32Error();
            throw new System.ComponentModel.Win32Exception(error);
        }

        return hwnd;
    }

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
        }

        return DefWindowProc(hwnd, msg, wParam, lParam);
    }


    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr GetModuleHandle(string lpModuleName);

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

    [DllImport("user32.dll")]
    public static extern IntPtr DefWindowProc(
        IntPtr hWnd,
        uint msg,
        UIntPtr wParam,
        IntPtr lParam
    );

    [DllImport("user32.dll")]
    public static extern bool DestroyWindow(
        IntPtr hWnd
    );

    [DllImport("user32.dll")]
    public static extern void PostQuitMessage(
        int nExitCode
    );

    [DllImport("user32.dll")]
    public static extern IntPtr LoadCursor(
        IntPtr hInstance,
        IntPtr lpCursorName
    );

    [DllImport("user32.dll")]
    public static extern bool AdjustWindowRect(
        ref RECT lpRect,
        uint dwStyle,
        bool bMenu
    );

    [DllImport("user32.dll")]
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

    [DllImport("user32.dll")]
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


# ------------------------------------------------------------
# 2. Framebuffer
# ------------------------------------------------------------

$Width  = 400
$Height = 300

$BufferSize = $Width * $Height * 4

$RawBuffer = New-Object byte[] $BufferSize


# BITMAPINFOHEADER = 40 bytes
$BitmapInfo = New-Object byte[] 40

[BitConverter]::GetBytes([int]40).CopyTo(
    $BitmapInfo, 0
)

[BitConverter]::GetBytes([int]$Width).CopyTo(
    $BitmapInfo, 4
)

# Negative = top-down DIB
[BitConverter]::GetBytes([int]-$Height).CopyTo(
    $BitmapInfo, 8
)

[BitConverter]::GetBytes([int16]1).CopyTo(
    $BitmapInfo, 12
)

[BitConverter]::GetBytes([int16]32).CopyTo(
    $BitmapInfo, 14
)

# BI_RGB
[BitConverter]::GetBytes([int]0).CopyTo(
    $BitmapInfo, 16
)


# ------------------------------------------------------------
# 3. JScript engine
# ------------------------------------------------------------

$JSContext = New-Object -ComObject "htmlfile"


# IMPORTANT:
#
# Instead of:
#
#     128,64,200,255,128,65,201,255,...
#
# JS produces a binary BSTR.
#
# Each UTF-16 character stores exactly TWO framebuffer bytes:
#
#     char 0 = B | (G << 8)
#     char 1 = R | (A << 8)
#
# Since Windows/.NET are little endian, the underlying UTF-16
# bytes are exactly:
#
#     B G R A
#
# Therefore PowerShell can copy the entire returned string into
# byte[] with one Buffer.BlockCopy().
#
# No Split().
# No int conversion.
# No per-byte PowerShell loop.


$JSCode = @"
var width  = $Width;
var height = $Height;

var pixelCount = width * height;

// Two UTF-16 characters per pixel.
//
// Reused every frame; only the strings stored in its slots are
// replaced.
var packed = new Array(pixelCount * 2);

function RenderFrame(frameIndex)
{
    var p = 0;

    for (var y = 0; y < height; ++y)
    {
        for (var x = 0; x < width; ++x)
        {
            var r = (x + frameIndex) & 255;
            var g = (y + frameIndex) & 255;
            var b = 128;
            var a = 255;

            // little-endian bytes:
            //
            // first UTF-16 unit:
            //     low byte  = B
            //     high byte = G
            //
            // second:
            //     low byte  = R
            //     high byte = A

            packed[p++] =
                String.fromCharCode(
                    b | (g << 8)
                );

            packed[p++] =
                String.fromCharCode(
                    r | (a << 8)
                );
        }
    }

    return packed.join("");
}
"@

$JSContext.Script.execScript(
    $JSCode,
    "JScript"
)


# ------------------------------------------------------------
# 4. Normal Win32 window
# ------------------------------------------------------------

$hWnd = [Native]::CreateFramebufferWindow(
    "PowerShell + JScript Framebuffer",
    $Width,
    $Height
)

$hDC = [Native]::GetDC($hWnd)

if ($hDC -eq [IntPtr]::Zero) {
    throw "GetDC failed."
}


# Reuse these structures.
$Msg  = New-Object Native+MSG
$Rect = New-Object Native+RECT

$Frame = 0
$Running = $true


Write-Host "Running."
Write-Host "Close the native window to terminate."


# ------------------------------------------------------------
# 5. Main loop
# ------------------------------------------------------------

try {

    while ($Running) {

        # ====================================================
        # Process ALL waiting window messages first.
        #
        # This is important for dragging/resizing responsiveness.
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

            if ($Msg.message -eq [Native]::WM_QUIT) {
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
        # JavaScript renders one frame
        # ====================================================

        [string]$PackedFrame =
            $JSContext.Script.RenderFrame($Frame)


        # ====================================================
        # ONE bulk framebuffer conversion
        #
        # A .NET string is UTF-16.
        #
        # Every character contains exactly two framebuffer
        # bytes, so BlockCopy copies its underlying byte
        # representation straight into the GDI byte[].
        # ====================================================

        $Chars = $PackedFrame.ToCharArray()

        [Buffer]::BlockCopy(
            $Chars,
            0,
            $RawBuffer,
            0,
            $BufferSize
        )


        # ====================================================
        # Current drawable area
        # ====================================================

        if (
            [Native]::GetClientRect(
                $hWnd,
                [ref]$Rect
            )
        ) {

            $ClientWidth =
                $Rect.right - $Rect.left

            $ClientHeight =
                $Rect.bottom - $Rect.top


            if (
                $ClientWidth -gt 0 -and
                $ClientHeight -gt 0
            ) {

                [Native]::StretchDIBits(
                    $hDC,

                    0,
                    0,
                    $ClientWidth,
                    $ClientHeight,

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


        ++$Frame

        # Deliberately NO Start-Sleep.
        #
        # Render as quickly as JS -> COM -> GDI permits.
        # Pending messages are drained before every frame.
    }
}
finally {

    if ($hDC -ne [IntPtr]::Zero) {
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

        [Runtime.InteropServices.Marshal]::FinalReleaseComObject(
            $JSContext
        ) | Out-Null
    }

    Write-Host "Closed."
}
