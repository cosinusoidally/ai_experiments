param(
    [Parameter(Mandatory = $true)]
    [string]$JSFile,

    [int]$Width  = 400,
    [int]$Height = 300
)

# Resolve the JavaScript path immediately.
$JSFile = (Resolve-Path -LiteralPath $JSFile -ErrorAction Stop).Path


# ============================================================
# 1. Native Win32 helper
# ============================================================

$NativeSource = @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class FramebufferNativeV5
{
    public const uint CS_HREDRAW = 0x0002;
    public const uint CS_VREDRAW = 0x0001;

    public const uint WS_OVERLAPPEDWINDOW = 0x00CF0000;
    public const uint WS_VISIBLE          = 0x10000000;

    public const uint WM_DESTROY     = 0x0002;
    public const uint WM_CLOSE       = 0x0010;
    public const uint WM_PAINT       = 0x000F;
    public const uint WM_ERASEBKGND  = 0x0014;
    public const uint WM_TIMER       = 0x0113;

    public const uint DIB_RGB_COLORS = 0;
    public const uint SRCCOPY        = 0x00CC0020;

    public const int CW_USEDEFAULT =
        unchecked((int)0x80000000);

    private const int IDC_ARROW = 32512;

    private const string WindowClassName =
        "PS_Framebuffer_Timer_Window_V5";


    // ========================================================
    // Win32 structures
    // ========================================================

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


    [StructLayout(LayoutKind.Sequential)]
    public struct PAINTSTRUCT
    {
        public IntPtr hdc;

        [MarshalAs(UnmanagedType.Bool)]
        public bool fErase;

        public RECT rcPaint;

        [MarshalAs(UnmanagedType.Bool)]
        public bool fRestore;

        [MarshalAs(UnmanagedType.Bool)]
        public bool fIncUpdate;

        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
        public byte[] rgbReserved;
    }


    // ========================================================
    // Delegates / callbacks
    // ========================================================

    public delegate IntPtr WndProc(
        IntPtr hwnd,
        uint msg,
        UIntPtr wParam,
        IntPtr lParam
    );


    // Keep WndProc delegate alive for the entire process.
    private static readonly WndProc WindowProcDelegate =
        WindowProc;


    // Use System.Action rather than a custom delegate.
    //
    // Windows PowerShell can reliably convert a ScriptBlock
    // to System.Action.
    private static Action renderCallback;


    private static bool rendering = false;


    public static void SetRenderCallback(
        Action callback
    )
    {
        renderCallback = callback;
    }


    // ========================================================
    // Render callback invocation
    // ========================================================

    private static void RenderNow()
    {
        // Prevent nested rendering if another timer/paint
        // message gets dispatched while rendering.
        if (rendering)
            return;


        Action callback =
            renderCallback;


        if (callback == null)
            return;


        try
        {
            rendering = true;

            callback();
        }
        finally
        {
            rendering = false;
        }
    }


    // ========================================================
    // Window procedure
    // ========================================================

    private static IntPtr WindowProc(
        IntPtr hwnd,
        uint msg,
        UIntPtr wParam,
        IntPtr lParam
    )
    {
        switch (msg)
        {
            // ------------------------------------------------
            // Timer-driven rendering.
            //
            // WM_TIMER continues to be pumped by Windows while
            // DefWindowProc is inside the modal title-bar
            // move/resize loop.
            // ------------------------------------------------

            case WM_TIMER:
            {
                RenderNow();

                return IntPtr.Zero;
            }


            // ------------------------------------------------
            // Redraw after expose/minimize/restore/etc.
            // ------------------------------------------------

            case WM_PAINT:
            {
                PAINTSTRUCT ps;

                BeginPaint(
                    hwnd,
                    out ps
                );

                EndPaint(
                    hwnd,
                    ref ps
                );

                RenderNow();

                return IntPtr.Zero;
            }


            // ------------------------------------------------
            // We paint the entire client surface ourselves.
            // ------------------------------------------------

            case WM_ERASEBKGND:
            {
                return new IntPtr(1);
            }


            // ------------------------------------------------
            // Normal close button
            // ------------------------------------------------

            case WM_CLOSE:
            {
                KillTimer(
                    hwnd,
                    new UIntPtr(1)
                );

                DestroyWindow(
                    hwnd
                );

                return IntPtr.Zero;
            }


            // ------------------------------------------------
            // End message loop
            // ------------------------------------------------

            case WM_DESTROY:
            {
                PostQuitMessage(0);

                return IntPtr.Zero;
            }
        }


        return DefWindowProc(
            hwnd,
            msg,
            wParam,
            lParam
        );
    }


    // ========================================================
    // Window creation
    // ========================================================

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
            WindowProcDelegate;


        wc.hInstance =
            instance;


        wc.hCursor =
            LoadCursor(
                IntPtr.Zero,
                new IntPtr(IDC_ARROW)
            );


        // No automatic background brush.
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
            {
                throw new Win32Exception(
                    error
                );
            }
        }


        uint style =
            WS_OVERLAPPEDWINDOW |
            WS_VISIBLE;


        RECT r =
            new RECT();


        r.left   = 0;
        r.top    = 0;
        r.right  = clientWidth;
        r.bottom = clientHeight;


        // Convert requested CLIENT area size into the required
        // overall window dimensions.
        if (!AdjustWindowRect(
            ref r,
            style,
            false
        ))
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error()
            );
        }


        int outerWidth =
            r.right -
            r.left;


        int outerHeight =
            r.bottom -
            r.top;


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


        return hwnd;
    }


    // ========================================================
    // Render timer
    // ========================================================

    public static void StartRenderTimer(
        IntPtr hwnd,
        uint intervalMilliseconds
    )
    {
        UIntPtr result =
            SetTimer(
                hwnd,
                new UIntPtr(1),
                intervalMilliseconds,
                IntPtr.Zero
            );


        if (result == UIntPtr.Zero)
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error()
            );
        }
    }


    // ========================================================
    // GDI framebuffer blit
    // ========================================================

    public static bool Blit(
        IntPtr hwnd,
        byte[] framebuffer,
        byte[] bitmapInfo,
        int sourceWidth,
        int sourceHeight
    )
    {
        if (hwnd == IntPtr.Zero)
            return false;


        RECT rect;


        if (!GetClientRect(
            hwnd,
            out rect
        ))
        {
            return false;
        }


        int width =
            rect.right -
            rect.left;


        int height =
            rect.bottom -
            rect.top;


        // Minimized window.
        if (width <= 0 ||
            height <= 0)
        {
            return true;
        }


        IntPtr dc =
            GetDC(
                hwnd
            );


        if (dc == IntPtr.Zero)
            return false;


        try
        {
            StretchDIBits(
                dc,

                // Destination client area
                0,
                0,
                width,
                height,

                // Source framebuffer
                0,
                0,
                sourceWidth,
                sourceHeight,

                framebuffer,
                bitmapInfo,

                DIB_RGB_COLORS,
                SRCCOPY
            );


            return true;
        }
        finally
        {
            ReleaseDC(
                hwnd,
                dc
            );
        }
    }


    // ========================================================
    // Binary UTF-16 string -> reusable byte[] copy
    //
    // JS packs two framebuffer bytes into each UTF-16 code
    // unit. The returned COM BSTR becomes a .NET string.
    //
    // Pin that string and copy its raw bytes directly into the
    // GDI framebuffer.
    // ========================================================

    public static void CopyStringBytes(
        string source,
        byte[] destination,
        int byteCount
    )
    {
        if (source == null)
        {
            throw new ArgumentNullException(
                "source"
            );
        }


        if (destination == null)
        {
            throw new ArgumentNullException(
                "destination"
            );
        }


        if (source.Length * 2 < byteCount)
        {
            throw new ArgumentException(
                "Source string is too short."
            );
        }


        if (destination.Length < byteCount)
        {
            throw new ArgumentException(
                "Destination buffer is too small."
            );
        }


        GCHandle handle =
            GCHandle.Alloc(
                source,
                GCHandleType.Pinned
            );


        try
        {
            Marshal.Copy(
                handle.AddrOfPinnedObject(),
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


    // ========================================================
    // Win32 imports
    // ========================================================

    [DllImport(
        "kernel32.dll",
        CharSet = CharSet.Unicode
    )]
    private static extern IntPtr GetModuleHandle(
        string lpModuleName
    );


    [DllImport(
        "user32.dll",
        CharSet = CharSet.Unicode,
        SetLastError = true
    )]
    private static extern ushort RegisterClassEx(
        ref WNDCLASSEX lpwcx
    );


    [DllImport(
        "user32.dll",
        CharSet = CharSet.Unicode,
        SetLastError = true
    )]
    private static extern IntPtr CreateWindowEx(
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
    private static extern IntPtr DefWindowProc(
        IntPtr hWnd,
        uint msg,
        UIntPtr wParam,
        IntPtr lParam
    );


    [DllImport("user32.dll")]
    private static extern bool DestroyWindow(
        IntPtr hWnd
    );


    [DllImport("user32.dll")]
    private static extern void PostQuitMessage(
        int exitCode
    );


    [DllImport(
        "user32.dll",
        SetLastError = true
    )]
    private static extern bool AdjustWindowRect(
        ref RECT lpRect,
        uint dwStyle,
        bool bMenu
    );


    [DllImport("user32.dll")]
    private static extern IntPtr LoadCursor(
        IntPtr hInstance,
        IntPtr lpCursorName
    );


    [DllImport(
        "user32.dll",
        SetLastError = true
    )]
    private static extern UIntPtr SetTimer(
        IntPtr hWnd,
        UIntPtr nIDEvent,
        uint uElapse,
        IntPtr lpTimerFunc
    );


    [DllImport("user32.dll")]
    private static extern bool KillTimer(
        IntPtr hWnd,
        UIntPtr uIDEvent
    );


    [DllImport(
        "user32.dll",
        CharSet = CharSet.Unicode
    )]
    public static extern int GetMessage(
        out MSG lpMsg,
        IntPtr hWnd,
        uint min,
        uint max
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
    private static extern bool GetClientRect(
        IntPtr hWnd,
        out RECT rect
    );


    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(
        IntPtr hWnd
    );


    [DllImport("user32.dll")]
    private static extern int ReleaseDC(
        IntPtr hWnd,
        IntPtr hDC
    );


    [DllImport("gdi32.dll")]
    private static extern int StretchDIBits(
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

        uint usage,
        uint rop
    );


    [DllImport("user32.dll")]
    private static extern IntPtr BeginPaint(
        IntPtr hwnd,
        out PAINTSTRUCT lpPaint
    );


    [DllImport("user32.dll")]
    private static extern bool EndPaint(
        IntPtr hWnd,
        ref PAINTSTRUCT lpPaint
    );
}
"@


Add-Type -TypeDefinition $NativeSource


# ============================================================
# 2. Framebuffer configuration
# ============================================================

if ($Width -le 0 -or $Height -le 0) {
    throw "Width and Height must be greater than zero."
}


$BufferSize =
    $Width *
    $Height *
    4


# Reusable BGRA framebuffer.
$RawBuffer =
    New-Object byte[] $BufferSize


# ============================================================
# 3. BITMAPINFOHEADER
# ============================================================

$BitmapInfo =
    New-Object byte[] 40


# biSize = sizeof(BITMAPINFOHEADER)
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


# Negative height => top-down DIB.
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


# biCompression = BI_RGB
[BitConverter]::GetBytes(
    [int]0
).CopyTo(
    $BitmapInfo,
    16
)


# ============================================================
# 4. Create MSHTML/JScript context
# ============================================================

$JSContext =
    New-Object -ComObject "htmlfile"


# ============================================================
# 5. Host-provided JavaScript globals
#
# The external .js file receives:
#
#     width
#     height
#
# and must provide:
#
#     function RenderFrame(frameIndex)
#
# RenderFrame must return width * height * 2 UTF-16
# characters, representing width * height * 4 BGRA bytes.
# ============================================================

$BootstrapJS = @"
var width = $Width;
var height = $Height;
"@


$JSContext.Script.execScript(
    $BootstrapJS,
    "JScript"
)


# ============================================================
# 6. Load JavaScript from file
# ============================================================

$ExternalJS =
    [IO.File]::ReadAllText(
        $JSFile
    )


try {
    $JSContext.Script.execScript(
        $ExternalJS,
        "JScript"
    )
}
catch {
    throw (
        "Failed to execute JavaScript file '$JSFile': " +
        $_.Exception.Message
    )
}


# Verify that the required function exists.
$HasRenderer =
    $JSContext.Script.eval(
        "typeof RenderFrame === 'function'"
    )


if (-not $HasRenderer) {
    throw (
        "JavaScript file '$JSFile' does not define " +
        "function RenderFrame(frameIndex)."
    )
}


Write-Host ""
Write-Host "Loaded JavaScript:"
Write-Host "  $JSFile"
Write-Host ""


# ============================================================
# 7. Create native window
# ============================================================

$WindowTitle =
    "JScript Framebuffer - " +
    [IO.Path]::GetFileName(
        $JSFile
    )


$hWnd =
    [FramebufferNativeV5]::CreateFramebufferWindow(
        $WindowTitle,
        $Width,
        $Height
    )


if ($hWnd -eq [IntPtr]::Zero) {
    throw "Unable to create native window."
}


# ============================================================
# 8. Rendering callback
#
# WM_TIMER causes this callback to run.
#
# Because Windows continues dispatching WM_TIMER during its
# modal move/resize loop, rendering continues while dragging
# the title bar.
# ============================================================

$script:Frame = 0


$RenderCallback = {

    # --------------------------------------------------------
    # A. Render one frame inside JScript
    # --------------------------------------------------------

    [string]$PackedFrame =
        $JSContext.Script.eval(
            "RenderFrame($script:Frame)"
        )


    if ($null -eq $PackedFrame) {
        throw "RenderFrame returned null."
    }


    # --------------------------------------------------------
    # B. Validate returned framebuffer size
    #
    # Every UTF-16 char encodes exactly two framebuffer bytes.
    # --------------------------------------------------------

    $ActualBytes =
        $PackedFrame.Length * 2


    if ($ActualBytes -ne $BufferSize) {
        throw (
            "RenderFrame returned $ActualBytes bytes; " +
            "expected $BufferSize bytes " +
            "($Width x $Height x 4)."
        )
    }


    # --------------------------------------------------------
    # C. One bulk binary memory copy
    # --------------------------------------------------------

    [FramebufferNativeV5]::CopyStringBytes(
        $PackedFrame,
        $RawBuffer,
        $BufferSize
    )


    # --------------------------------------------------------
    # D. Blit framebuffer to current client area
    # --------------------------------------------------------

    [FramebufferNativeV5]::Blit(
        $hWnd,
        $RawBuffer,
        $BitmapInfo,
        $Width,
        $Height
    ) | Out-Null


    $script:Frame++
}


# ============================================================
# 9. Convert ScriptBlock to System.Action
#
# This is the fix for the previous custom-delegate conversion
# problem.
# ============================================================

[Action]$RenderDelegate =
    $RenderCallback


# Keep $RenderDelegate referenced for the entire window lifetime.
[FramebufferNativeV5]::SetRenderCallback(
    $RenderDelegate
)


# ============================================================
# 10. Start render timer
#
# 1 ms does NOT mean that this will necessarily render at
# 1000 FPS.
#
# WM_TIMER is low-priority and coalesced. It essentially means
# "render whenever the message queue has an opportunity".
# ============================================================

[FramebufferNativeV5]::StartRenderTimer(
    $hWnd,
    1
)


Write-Host "Framebuffer size: $Width x $Height"
Write-Host "Rendering is WM_TIMER-driven."
Write-Host "The animation should continue while moving/resizing."
Write-Host "Close the window to exit."
Write-Host ""


# ============================================================
# 11. Standard single-threaded Win32 message loop
# ============================================================

$Msg =
    New-Object FramebufferNativeV5+MSG


try {

    while ($true) {

        $Result =
            [FramebufferNativeV5]::GetMessage(
                [ref]$Msg,
                [IntPtr]::Zero,
                0,
                0
            )


        # WM_QUIT
        if ($Result -eq 0) {
            break
        }


        # GetMessage error
        if ($Result -lt 0) {
            throw "GetMessage failed."
        }


        [FramebufferNativeV5]::TranslateMessage(
            [ref]$Msg
        ) | Out-Null


        [FramebufferNativeV5]::DispatchMessage(
            [ref]$Msg
        ) | Out-Null
    }
}
finally {

    # ========================================================
    # 12. Cleanup
    # ========================================================

    [FramebufferNativeV5]::SetRenderCallback(
        $null
    )


    $RenderDelegate = $null
    $RenderCallback = $null


    if ($null -ne $JSContext) {

        [Runtime.InteropServices.Marshal]::FinalReleaseComObject(
            $JSContext
        ) | Out-Null


        $JSContext = $null
    }


    Write-Host ""
    Write-Host "Application closed."
}
