# 1. Compile Win32 GDI & User32 functions via C# P/Invoke 
$Win32Signature = @"
using System;
using System.Runtime.InteropServices;

public class Win32 {
    [DllImport("user32.dll")]
    public static extern IntPtr CreateWindowExW(uint dwExStyle, string lpClassName, string lpWindowName, uint dwStyle, int x, int y, int nWidth, int nHeight, IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);

    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("user32.dll")]
    public static extern bool PeekMessageW(IntPtr lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

    [DllImport("gdi32.dll")]
    public static extern int StretchDIBits(IntPtr hdc, int xDest, int yDest, int DestWidth, int DestHeight, int xSrc, int ySrc, int SrcWidth, int SrcHeight, byte[] lpBits, byte[] lpBitsInfo, uint iUsage, uint dwRop);
}
"@
Add-Type -TypeDefinition $Win32Signature

# 2. Window & Framebuffer Specifications
$Width  = 400
$Height = 300
$PixelCount = $Width * $Height
$BufferSize = $PixelCount * 4 # 4 Bytes per pixel: B, G, R, Alpha

# Build the Win32 BITMAPINFO structure header byte-array (44 bytes total)
$BitmapInfo = New-Object byte[] 44
[System.BitConverter]::GetBytes([int]40).CopyTo($BitmapInfo, 0)       # biSize = 40
[System.BitConverter]::GetBytes([int]$Width).CopyTo($BitmapInfo, 4)   # biWidth
[System.BitConverter]::GetBytes([int]-$Height).CopyTo($BitmapInfo, 8)  # biHeight (- forces top-left origin)
$BitmapInfo[12] = 1                                                   # biPlanes = 1
$BitmapInfo[14] = 32                                                  # biBitCount = 32 bits (ARGB)

# 3. Initialize the In-Memory Headless JavaScript Engine
$JSContext = New-Object -ComObject "htmlfile"

# Inject the logic directly into the script engine memory context via execScript
# This completely bypasses the problematic HTML document .write pipeline
$JSCode = "var width = " + $Width + ";" +
"var height = " + $Height + ";" +
"var pixels = new Array(width * height * 4);" +
"function RenderFrame(frameIndex) {" +
"    var idx = 0;" +
"    for (var y = 0; y < height; y++) {" +
"        for (var x = 0; x < width; x++) {" +
"            var r = (x + frameIndex) % 256;" +
"            var g = (y + frameIndex) % 256;" +
"            var b = 128;" +
"            pixels[idx]     = b;" +
"            pixels[idx + 1] = g;" +
"            pixels[idx + 2] = r;" +
"            pixels[idx + 3] = 0;" +
"            idx += 4;" +
"        }" +
"    }" +
"    return pixels.join(',');" +
"}"

# "JScript" tells the document tree to execute this raw string inside its script container
$JSContext.Script.execScript($JSCode, "JScript")

# 4. Spawn a real native Win32 window container
# WS_OVERLAPPEDWINDOW (0x00CF0000) | WS_VISIBLE (0x10000000)
$hWnd = [Win32]::CreateWindowExW(0, "Static", "Native PS + JS Framebuffer Engine", 0x10CF0000, 100, 100, ($Width + 16), ($Height + 39), 0, 0, 0, 0)
$hDC  = [Win32]::GetDC($hWnd)

# Allocate memory space for the Win32 message loop struct parsing
$MsgStruct = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(28)
$RawBuffer = New-Object byte[] $BufferSize

Write-Host "Window activated. JavaScript rendering engine frames loop running..."
Write-Host "Press CTRL+C inside the PowerShell host console to close application handles."

$Frame = 0
$Running = $true

# 5. Primary Application Loop
try {
    while ($Running) {
        # A. Process window messages to keep GUI interactive and prevent freezing
        while ([Win32]::PeekMessageW($MsgStruct, $hWnd, 0, 0, 1)) {
            $MsgType = [System.Runtime.InteropServices.Marshal]::ReadInt32($MsgStruct, 4)
            if ($MsgType -eq 0x0012 -or $MsgType -eq 0x0002) { # WM_QUIT or WM_DESTROY
                $Running = $false
            }
        }

        # B. Call the JavaScript engine function to execute software array pixel operations
        $JsPixelString = $JSContext.Script.RenderFrame($Frame)
        
        # C. Parse comma-separated JavaScript string into native PowerShell byte array
        $PixelArray = $JsPixelString.Split(',')
        for ($i = 0; $i -lt $BufferSize; $i++) {
            $RawBuffer[$i] = [byte][int]$PixelArray[$i]
        }

        # D. Blit (transfer) raw memory bytes straight to the Win32 window surface via GDI
        # Usage: 0 = DIB_RGB_COLORS, Rop: 0xCC0020 = SRCCOPY
        $null = [Win32]::StretchDIBits($hDC, 0, 0, $Width, $Height, 0, 0, $Width, $Height, $RawBuffer, $BitmapInfo, 0, 0xCC0020)

        $Frame++
        Start-Sleep -Milliseconds 16 # Target standard ~60FPS synchronization frequency
    }
}
finally {
    # 6. Safe System Resource Clean Up Handling
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($MsgStruct)
    $null = [Win32]::ReleaseDC($hWnd, $hDC)
    Write-Host "`nApplication closed safely. Device resources unmapped."
}
