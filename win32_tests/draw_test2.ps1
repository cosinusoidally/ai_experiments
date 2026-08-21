# ============================================================
# Native PowerShell + JavaScript framebuffer
# Rendered inside a normal Win32 application window
# ============================================================

# 1. Win32 API declarations
$Win32Signature = @"
using System;
using System.Runtime.InteropServices;

public static class Win32
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int pt_x;
        public int pt_y;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateWindowExW(
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
    public static extern bool ShowWindow(
        IntPtr hWnd,
        int nCmdShow
    );

    [DllImport("user32.dll")]
    public static extern bool UpdateWindow(
        IntPtr hWnd
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

    [DllImport("user32.dll")]
    public static extern bool GetClientRect(
        IntPtr hWnd,
        out RECT lpRect
    );

    [DllImport("user32.dll")]
    public static extern bool PeekMessageW(
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
    public static extern IntPtr DispatchMessageW(
        ref MSG lpMsg
    );

    [DllImport("user32.dll")]
    public static extern bool DestroyWindow(
        IntPtr hWnd
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

Add-Type -TypeDefinition $Win32Signature


# ============================================================
# 2. Logical framebuffer
# ============================================================

$Width  = 400
$Height = 300

$PixelCount = $Width * $Height
$BufferSize = $PixelCount * 4


# BITMAPINFOHEADER
$BitmapInfo = New-Object byte[] 40

# biSize
[System.BitConverter]::GetBytes([int]40).CopyTo(
    $BitmapInfo, 0
)

# biWidth
[System.BitConverter]::GetBytes([int]$Width).CopyTo(
    $BitmapInfo, 4
)

# Negative height = top-down bitmap
[System.BitConverter]::GetBytes([int]-$Height).CopyTo(
    $BitmapInfo, 8
)

# biPlanes = 1
[System.BitConverter]::GetBytes([int16]1).CopyTo(
    $BitmapInfo, 12
)

# biBitCount = 32
[System.BitConverter]::GetBytes([int16]32).CopyTo(
    $BitmapInfo, 14
)

# biCompression = BI_RGB = 0
[System.BitConverter]::GetBytes([int]0).CopyTo(
    $BitmapInfo, 16
)


# ============================================================
# 3. JavaScript rendering engine
# ============================================================

$JSContext = New-Object -ComObject "htmlfile"

$JSCode = @"
var width = $Width;
var height = $Height;

var pixels = new Array(width * height * 4);

function RenderFrame(frameIndex)
{
    var idx = 0;

    for (var y = 0; y < height; y++)
    {
        for (var x = 0; x < width; x++)
        {
            var r = (x + frameIndex) % 256;
            var g = (y + frameIndex) % 256;
            var b = 128;

            // Windows 32-bit BI_RGB DIB is BGRA
            pixels[idx]     = b;
            pixels[idx + 1] = g;
            pixels[idx + 2] = r;
            pixels[idx + 3] = 255;

            idx += 4;
        }
    }

    return pixels.join(',');
}
"@

$JSContext.Script.execScript(
    $JSCode,
    "JScript"
)


# ============================================================
# 4. Create a NORMAL Win32 window
# ============================================================

# Window style:
#
# WS_OVERLAPPEDWINDOW =
#   WS_OVERLAPPED
#   WS_CAPTION
#   WS_SYSMENU
#   WS_THICKFRAME
#   WS_MINIMIZEBOX
#   WS_MAXIMIZEBOX
#
# Plus WS_VISIBLE.

$WS_OVERLAPPEDWINDOW = 0x00CF0000
$WS_VISIBLE          = 0x10000000

$WindowStyle = $WS_OVERLAPPEDWINDOW -bor $WS_VISIBLE


# Give the outer window some extra room for its
# titlebar/borders. The framebuffer itself remains 400x300.
$OuterWidth  = $Width  + 40
$OuterHeight = $Height + 80

$hWnd = [Win32]::CreateWindowExW(
    0,
    "Static",
    "Native PowerShell + JavaScript Framebuffer",
    $WindowStyle,
    100,
    100,
    $OuterWidth,
    $OuterHeight,
    [IntPtr]::Zero,
    [IntPtr]::Zero,
    [IntPtr]::Zero,
    [IntPtr]::Zero
)

if ($hWnd -eq [IntPtr]::Zero) {
    throw "CreateWindowExW failed."
}


# SW_SHOW = 5
[Win32]::ShowWindow($hWnd, 5) | Out-Null
[Win32]::UpdateWindow($hWnd) | Out-Null


# ============================================================
# 5. Create framebuffer
# ============================================================

$RawBuffer = New-Object byte[] $BufferSize

$Frame   = 0
$Running = $true

Write-Host "Native window created."
Write-Host "Close the window normally using its X button."
Write-Host "CTRL+C in PowerShell also terminates the loop."


# Win32 message constants
$WM_CLOSE   = 0x0010
$WM_DESTROY = 0x0002
$WM_QUIT    = 0x0012

# PM_REMOVE
$PM_REMOVE = 1

# StretchDIBits values
$DIB_RGB_COLORS = 0
$SRCCOPY        = 0x00CC0020


# ============================================================
# 6. Main application loop
# ============================================================

try {

    while ($Running) {

        # ----------------------------------------------------
        # A. Process the REAL Win32 message queue
        # ----------------------------------------------------

        $Msg = New-Object Win32+MSG

        # IntPtr.Zero means process messages for this thread,
        # not only messages specifically targeted at our HWND.
        while (
            [Win32]::PeekMessageW(
                [ref]$Msg,
                [IntPtr]::Zero,
                0,
                0,
                $PM_REMOVE
            )
        ) {

            if ($Msg.message -eq $WM_QUIT) {
                $Running = $false
                break
            }

            # The predefined "Static" class has a native
            # window procedure, so DispatchMessage lets Windows
            # process minimize/maximize/moving/sizing/etc.
            [Win32]::TranslateMessage(
                [ref]$Msg
            ) | Out-Null

            [Win32]::DispatchMessageW(
                [ref]$Msg
            ) | Out-Null
        }


        if (-not $Running) {
            break
        }


        # Check that the window still exists / hasn't closed
        #
        # A WM_CLOSE sent to the predefined Static class normally
        # destroys the HWND. GetDC returning zero tells us the
        # drawing target is gone.
        $hDC = [Win32]::GetDC($hWnd)

        if ($hDC -eq [IntPtr]::Zero) {
            break
        }


        try {

            # ------------------------------------------------
            # B. Ask JavaScript to render the logical frame
            # ------------------------------------------------

            $JsPixelString = $JSContext.Script.RenderFrame($Frame)


            # ------------------------------------------------
            # C. Convert JS array data to byte framebuffer
            # ------------------------------------------------

            $PixelArray = $JsPixelString.Split(',')

            for ($i = 0; $i -lt $BufferSize; $i++) {
                $RawBuffer[$i] = [byte][int]$PixelArray[$i]
            }


            # ------------------------------------------------
            # D. Determine current CLIENT AREA size
            # ------------------------------------------------

            $ClientRect = New-Object Win32+RECT

            if (
                [Win32]::GetClientRect(
                    $hWnd,
                    [ref]$ClientRect
                )
            ) {

                $ClientWidth =
                    $ClientRect.Right -
                    $ClientRect.Left

                $ClientHeight =
                    $ClientRect.Bottom -
                    $ClientRect.Top


                # Don't draw while minimized.
                if (
                    $ClientWidth -gt 0 -and
                    $ClientHeight -gt 0
                ) {

                    # ----------------------------------------
                    # E. Paint framebuffer into client area
                    # ----------------------------------------

                    [Win32]::StretchDIBits(
                        $hDC,

                        # Destination
                        0,
                        0,
                        $ClientWidth,
                        $ClientHeight,

                        # Source
                        0,
                        0,
                        $Width,
                        $Height,

                        # Pixel data / bitmap description
                        $RawBuffer,
                        $BitmapInfo,

                        $DIB_RGB_COLORS,
                        $SRCCOPY
                    ) | Out-Null
                }
            }
        }
        finally {

            [Win32]::ReleaseDC(
                $hWnd,
                $hDC
            ) | Out-Null
        }


        $Frame++

        # ~60 Hz
        Start-Sleep -Milliseconds 16
    }
}
finally {

    if ($hWnd -ne [IntPtr]::Zero) {
        [Win32]::DestroyWindow($hWnd) | Out-Null
    }

    if ($null -ne $JSContext) {
        [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject(
            $JSContext
        ) | Out-Null
    }

    Write-Host ""
    Write-Host "Application closed."
}
