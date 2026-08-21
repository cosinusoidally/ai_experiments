# ============================================================
# Single-threaded PowerShell + JScript framebuffer
#
# - Normal Win32 window
# - NO worker/UI threads
# - Rendering driven by WM_TIMER
# - WM_TIMER continues during titlebar move/resize modal loops
# - JScript remains on the PowerShell/STA thread
# - Binary BSTR framebuffer transfer
# - One bulk framebuffer copy
# ============================================================


# ============================================================
# 1. Native Win32 helper
# ============================================================

$NativeSource = @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class FramebufferNativeV4
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
    public const uint WM_TIMER        = 0x0113;
    public const uint WM_ERASEBKGND   = 0x0014;
    public const uint WM_PAINT        = 0x000F;

    public const uint DIB_RGB_COLORS = 0;
    public const uint SRCCOPY        = 0x00CC0020;

    public const int CW_USEDEFAULT =
        unchecked((int)0x80000000);

    private const int IDC_ARROW = 32512;

    private const string WindowClassName =
        "PS_Framebuffer_Timer_Window_V4";


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


    [StructLayout(LayoutKind.Sequential)]
    public struct PAINTSTRUCT
    {
        public IntPtr hdc;
        public bool fErase;

        public RECT rcPaint;

        public bool fRestore;
        public bool fIncUpdate;

        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
        public byte[] rgbReserved;
    }


    // --------------------------------------------------------
    // Delegates
    // --------------------------------------------------------

    public delegate IntPtr WndProc(
        IntPtr hwnd,
        uint msg,
        UIntPtr wParam,
        IntPtr lParam
    );


    public delegate void RenderCallback();


    // Keep these alive.
    private static readonly WndProc WindowProcDelegate =
        WindowProc;


    private static RenderCallback renderCallback;


    // Protect against nested rendering.
    private static bool rendering = false;


    // --------------------------------------------------------
    // Install PowerShell callback
    // --------------------------------------------------------

    public static void SetRenderCallback(
        RenderCallback callback
    )
    {
        renderCallback = callback;
    }


    // --------------------------------------------------------
    // Window procedure
    // --------------------------------------------------------

    private static IntPtr WindowProc(
        IntPtr hwnd,
        uint msg,
        UIntPtr wParam,
        IntPtr lParam
    )
    {
        switch (msg)
        {
            case WM_TIMER:
            {
                // WM_TIMER keeps getting dispatched while
                // DefWindowProc is inside the modal window
                // move/size loop.

                RenderNow();

                return IntPtr.Zero;
            }


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

                // Request a redraw using current framebuffer.
                RenderNow();

                return IntPtr.Zero;
            }


            case WM_ERASEBKGND:
            {
                // Avoid flicker because our framebuffer covers
                // the client area.
                return new IntPtr(1);
            }


            case WM_CLOSE:
            {
                KillTimer(
                    hwnd,
                    new UIntPtr(1)
                );

                DestroyWindow(hwnd);

                return IntPtr.Zero;
            }


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


    private static void RenderNow()
    {
        if (rendering)
            return;

        RenderCallback callback =
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


    // --------------------------------------------------------
    // Create native window
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
            WindowProcDelegate;

        wc.hInstance =
            instance;

        wc.hCursor =
            LoadCursor(
                IntPtr.Zero,
                new IntPtr(IDC_ARROW)
            );

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


    // --------------------------------------------------------
    // Timer
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // Draw framebuffer
    // --------------------------------------------------------

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


        // Minimized.
        if (width <= 0 ||
            height <= 0)
        {
            return true;
        }


        IntPtr dc =
            GetDC(hwnd);


        if (dc == IntPtr.Zero)
            return false;


        try
        {
            StretchDIBits(
                dc,

                0,
                0,
                width,
                height,

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


    // --------------------------------------------------------
    // Binary UTF-16 string -> byte[]
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
# 2. Framebuffer
# ============================================================

$Width  = 400
$Height = 300

$BufferSize =
    $Width *
    $Height *
    4


$RawBuffer =
    New-Object byte[] $BufferSize


# ============================================================
# 3. BITMAPINFOHEADER
# ============================================================

$BitmapInfo =
    New-Object byte[] 40


# biSize
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


# Negative height => top-down DIB
[BitConverter]::GetBytes(
    [int]-$Height
).CopyTo(
    $BitmapInfo,
    8
)


# biPlanes
[BitConverter]::GetBytes(
    [int16]1
).CopyTo(
    $BitmapInfo,
    12
)


# biBitCount
[BitConverter]::GetBytes(
    [int16]32
).CopyTo(
    $BitmapInfo,
    14
)


# BI_RGB
[BitConverter]::GetBytes(
    [int]0
).CopyTo(
    $BitmapInfo,
    16
)


# ============================================================
# 4. JScript engine
# ============================================================

$JSContext =
    New-Object -ComObject "htmlfile"


$JSCode = @"
var width  = $Width;
var height = $Height;

var pixelCount =
    width * height;


/*
    Reused JS array.

    Two UTF-16 characters encode one BGRA pixel.
*/
var packed =
    new Array(pixelCount * 2);


var blue =
    128;


var opaque =
    255 << 8;


function RenderFrame(frameIndex)
{
    var output = 0;

    var f =
        frameIndex & 255;


    for (
        var y = 0;
        y < height;
        ++y
    )
    {
        var g =
            (y + f) & 255;


        var bg =
            blue |
            (g << 8);


        for (
            var x = 0;
            x < width;
            ++x
        )
        {
            var r =
                (x + f) & 255;


            packed[output++] =
                String.fromCharCode(
                    bg
                );


            packed[output++] =
                String.fromCharCode(
                    r | opaque
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


# ============================================================
# 5. Create window
# ============================================================

$hWnd =
    [FramebufferNativeV4]::
        CreateFramebufferWindow(
            "PowerShell + JScript Framebuffer",
            $Width,
            $Height
        )


if ($hWnd -eq [IntPtr]::Zero) {
    throw "Unable to create window."
}


# ============================================================
# 6. Render callback
#
# THIS executes on the main PowerShell thread.
#
# Normally it is called by WM_TIMER from our ordinary message
# loop.
#
# During titlebar dragging, DefWindowProc enters its own modal
# loop. That modal loop also dispatches WM_TIMER, so this same
# callback continues executing while the window is moving.
# ============================================================

$Frame = 0


$RenderCallback = {

    # --------------------------------------------------------
    # JScript render
    # --------------------------------------------------------

    [string]$PackedFrame =
        $JSContext.Script.eval(
            "RenderFrame($Frame)"
        )


    # --------------------------------------------------------
    # Bulk-copy BSTR's UTF-16 bytes into framebuffer
    # --------------------------------------------------------

    [FramebufferNativeV4]::
        CopyStringBytes(
            $PackedFrame,
            $RawBuffer,
            $BufferSize
        )


    # --------------------------------------------------------
    # Draw it
    # --------------------------------------------------------

    [FramebufferNativeV4]::
        Blit(
            $hWnd,
            $RawBuffer,
            $BitmapInfo,
            $Width,
            $Height
        ) | Out-Null


    $script:Frame++

}


# Convert PowerShell scriptblock into our C# delegate type.
$RenderDelegate =
    [FramebufferNativeV4+RenderCallback]$RenderCallback


# Keep the delegate strongly referenced for the entire lifetime
# of the window.
[FramebufferNativeV4]::
    SetRenderCallback(
        $RenderDelegate
    )


# ============================================================
# 7. Start WM_TIMER
# ============================================================

# This is NOT intended as a 60 Hz limiter.
#
# Windows' normal user timer has limited resolution anyway.
# A 1 ms request simply means "generate WM_TIMER whenever the
# message queue permits".
#
# WM_TIMER is low-priority/coalesced, so it won't accumulate an
# enormous backlog if rendering takes longer than the interval.
[FramebufferNativeV4]::
    StartRenderTimer(
        $hWnd,
        1
    )


Write-Host ""
Write-Host "Running."
Write-Host "Rendering is driven by WM_TIMER."
Write-Host "Try dragging the title bar."
Write-Host ""


# ============================================================
# 8. NORMAL SINGLE-THREADED Win32 message loop
# ============================================================

$Msg =
    New-Object FramebufferNativeV4+MSG


try {

    while ($true) {

        $Result =
            [FramebufferNativeV4]::
                GetMessage(
                    [ref]$Msg,
                    [IntPtr]::Zero,
                    0,
                    0
                )


        # WM_QUIT
        if ($Result -eq 0) {
            break
        }


        if ($Result -lt 0) {
            throw "GetMessage failed."
        }


        [FramebufferNativeV4]::
            TranslateMessage(
                [ref]$Msg
            ) | Out-Null


        [FramebufferNativeV4]::
            DispatchMessage(
                [ref]$Msg
            ) | Out-Null
    }
}
finally {

    # Remove reference from native class first.
    [FramebufferNativeV4]::
        SetRenderCallback(
            $null
        )


    $RenderDelegate = $null


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
