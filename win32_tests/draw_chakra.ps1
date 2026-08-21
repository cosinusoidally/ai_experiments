param(
    [Parameter(Mandatory = $true)]
    [string]$JSFile,

    [int]$Width  = 400,
    [int]$Height = 300
)

$ErrorActionPreference = "Stop"

$JSFile = (
    Resolve-Path -LiteralPath $JSFile
).Path

if ($Width -le 0 -or $Height -le 0) {
    throw "Width and Height must be greater than zero."
}


# ============================================================
# C# host
#
# PowerShell only starts this host.
#
# Everything performance-sensitive happens inside C#:
#
#   - Win32 window
#   - Chakra runtime
#   - unmanaged framebuffer
#   - external ArrayBuffer
#   - JS invocation
#   - StretchDIBits
#   - message pump
#
# ============================================================

$Source = @"
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;

public static class ChakraFramebufferHost
{
    // ========================================================
    // Win32 constants
    // ========================================================

    private const uint CS_HREDRAW = 0x0002;
    private const uint CS_VREDRAW = 0x0001;

    private const uint WS_OVERLAPPEDWINDOW = 0x00CF0000;
    private const uint WS_VISIBLE          = 0x10000000;

    private const uint WM_DESTROY       = 0x0002;
    private const uint WM_CLOSE         = 0x0010;
    private const uint WM_PAINT         = 0x000F;
    private const uint WM_ERASEBKGND    = 0x0014;
    private const uint WM_QUIT          = 0x0012;

    private const uint WM_ENTERSIZEMOVE = 0x0231;
    private const uint WM_EXITSIZEMOVE  = 0x0232;
    private const uint WM_TIMER         = 0x0113;

    private const uint PM_REMOVE = 0x0001;

    private const int CW_USEDEFAULT =
        unchecked((int)0x80000000);

    private const int IDC_ARROW = 32512;

    private const uint DIB_RGB_COLORS = 0;
    private const uint SRCCOPY        = 0x00CC0020;

    private const uint BI_RGB = 0;


    // ========================================================
    // Chakra constants
    // ========================================================

    private const uint JsNoError = 0;

    // JsRuntimeAttributeNone
    private const uint JsRuntimeAttributeNone = 0;


    // ========================================================
    // State
    // ========================================================

    private static IntPtr hwnd = IntPtr.Zero;

    private static IntPtr framebuffer = IntPtr.Zero;

    private static int sourceWidth;
    private static int sourceHeight;
    private static int framebufferBytes;


    // Chakra state
    private static IntPtr jsRuntime = IntPtr.Zero;
    private static IntPtr jsContext = IntPtr.Zero;

    private static IntPtr jsArrayBuffer = IntPtr.Zero;
    private static IntPtr jsTickFunction = IntPtr.Zero;
    private static IntPtr jsUndefined = IntPtr.Zero;


    private static readonly Stopwatch animationClock =
        new Stopwatch();


    private static ulong sourceContext = 1;


    // Main render loop runs uncapped.
    //
    // During Windows' modal move/resize loop, our outer loop is
    // suspended, so WndProc temporarily uses WM_TIMER instead.
    private static bool insideSizeMove = false;

    private static bool rendering = false;
    private static bool running = false;


    private static string fatalError = null;


    private const string WindowClassName =
        "PowerShellChakraFramebufferWindow";


    // Keep the native delegate rooted.
    private static readonly WndProc wndProcDelegate =
        WindowProc;


    // ========================================================
    // Public entry point
    // ========================================================

    public static void Run(
        string jsFile,
        int width,
        int height
    )
    {
        if (width <= 0 || height <= 0)
            throw new ArgumentOutOfRangeException(
                "width/height"
            );


        checked
        {
            framebufferBytes =
                width *
                height *
                4;
        }


        sourceWidth  = width;
        sourceHeight = height;


        string jsSource =
            File.ReadAllText(jsFile);


        try
        {
            // ------------------------------------------------
            // Allocate framebuffer ONCE.
            // ------------------------------------------------

            framebuffer =
                Marshal.AllocHGlobal(
                    framebufferBytes
                );


            ZeroFramebuffer();


            // ------------------------------------------------
            // Create Chakra first.
            //
            // Everything remains on this single thread.
            // ------------------------------------------------

            InitializeChakra(
                jsSource,
                jsFile
            );


            // ------------------------------------------------
            // Create normal Win32 window.
            // ------------------------------------------------

            hwnd =
                CreateFramebufferWindow(
                    "Chakra Framebuffer - " +
                    Path.GetFileName(jsFile),
                    width,
                    height
                );


            running = true;


            animationClock.Restart();


            // Draw a first frame immediately.
            RenderAndBlit();


            // ------------------------------------------------
            // Main application loop
            //
            // This is intentionally NOT timer-driven.
            //
            // When no messages are waiting, render as fast as
            // Chakra + GDI can go.
            //
            // While titlebar move/resize enters a modal loop,
            // WM_TIMER takes over temporarily in WndProc.
            // ------------------------------------------------

            MSG msg;


            while (running)
            {
                // Drain all pending messages.
                while (
                    PeekMessage(
                        out msg,
                        IntPtr.Zero,
                        0,
                        0,
                        PM_REMOVE
                    )
                )
                {
                    if (msg.message == WM_QUIT)
                    {
                        running = false;
                        break;
                    }


                    TranslateMessage(
                        ref msg
                    );


                    DispatchMessage(
                        ref msg
                    );
                }


                if (!running)
                    break;


                // Normal operation = uncapped.
                RenderAndBlit();
            }


            if (fatalError != null)
            {
                throw new Exception(
                    fatalError
                );
            }
        }
        finally
        {
            Cleanup();
        }
    }


    // ========================================================
    // Chakra initialization
    // ========================================================

    private static void InitializeChakra(
        string userScript,
        string scriptFilename
    )
    {
        uint error;


        // ----------------------------------------------------
        // Create runtime.
        //
        // NOTE:
        // Windows chakra.dll differs from ChakraCore.dll here:
        // it includes a runtimeVersion parameter.
        // ----------------------------------------------------

        error =
            JsCreateRuntime(
                JsRuntimeAttributeNone,
                IntPtr.Zero,
                out jsRuntime
            );

        CheckJs(
            error,
            "JsCreateRuntime"
        );


        // ----------------------------------------------------
        // Create execution context.
        // ----------------------------------------------------

        error =
            JsCreateContext(
                jsRuntime,
                out jsContext
            );

        CheckJs(
            error,
            "JsCreateContext"
        );


        error =
            JsSetCurrentContext(
                jsContext
            );

        CheckJs(
            error,
            "JsSetCurrentContext"
        );


        // ----------------------------------------------------
        // Get JS undefined value.
        //
        // Needed as arguments[0] / thisArg for JsCallFunction.
        // ----------------------------------------------------

        error =
            JsGetUndefinedValue(
                out jsUndefined
            );

        CheckJs(
            error,
            "JsGetUndefinedValue"
        );


        // ----------------------------------------------------
        // Expose OUR framebuffer pointer as an ArrayBuffer.
        //
        // No copy.
        //
        // finalizeCallback = NULL because the host owns and
        // frees this memory after Chakra is disposed.
        // ----------------------------------------------------

        error =
            JsCreateExternalArrayBuffer(
                framebuffer,
                (uint)framebufferBytes,
                IntPtr.Zero,
                IntPtr.Zero,
                out jsArrayBuffer
            );

        CheckJs(
            error,
            "JsCreateExternalArrayBuffer"
        );


        // Keep an explicit Chakra reference too.
        uint ignoredRefCount;

        error =
            JsAddRef(
                jsArrayBuffer,
                out ignoredRefCount
            );

        CheckJs(
            error,
            "JsAddRef(ArrayBuffer)"
        );


        // ----------------------------------------------------
        // Put it on the global object:
        //
        //     global.framebuffer = ArrayBuffer
        // ----------------------------------------------------

        IntPtr globalObject;

        error =
            JsGetGlobalObject(
                out globalObject
            );

        CheckJs(
            error,
            "JsGetGlobalObject"
        );


        IntPtr framebufferProperty;

        error =
            JsGetPropertyIdFromName(
                "framebuffer",
                out framebufferProperty
            );

        CheckJs(
            error,
            "JsGetPropertyIdFromName(framebuffer)"
        );


        error =
            JsSetProperty(
                globalObject,
                framebufferProperty,
                jsArrayBuffer,
                false
            );

        CheckJs(
            error,
            "JsSetProperty(framebuffer)"
        );


        // ----------------------------------------------------
        // Bootstrap globals.
        //
        // JS now gets:
        //
        //     width
        //     height
        //     framebuffer : ArrayBuffer
        //     pixels      : Uint8Array
        //
        // pixels is THE SAME MEMORY StretchDIBits reads.
        // ----------------------------------------------------

        string bootstrap =
            "var width=" +
            sourceWidth.ToString(
                CultureInfo.InvariantCulture
            ) +
            ";" +

            "var height=" +
            sourceHeight.ToString(
                CultureInfo.InvariantCulture
            ) +
            ";" +

            "var pixels=new Uint8Array(framebuffer);";


        RunScript(
            bootstrap,
            "host-bootstrap.js"
        );


        // ----------------------------------------------------
        // Run external user renderer.
        // ----------------------------------------------------

        RunScript(
            userScript,
            scriptFilename
        );


        // ----------------------------------------------------
        // Validate interface. RenderFrame receives elapsed time
        // in seconds, so animation speed is independent of the
        // number of frames rendered.
        // ----------------------------------------------------

        string setup =
            "if(typeof RenderFrame!=='function')" +
            "throw new Error(" +
            "'The JS file must define RenderFrame(time)'" +
            ");";


        RunScript(
            setup,
            "host-render-loop.js"
        );


        // ----------------------------------------------------
        // Cache RenderFrame's JsValueRef.
        // ----------------------------------------------------

        IntPtr tickProperty;

        error =
            JsGetPropertyIdFromName(
                "RenderFrame",
                out tickProperty
            );

        CheckJs(
            error,
            "JsGetPropertyIdFromName(RenderFrame)"
        );


        error =
            JsGetProperty(
                globalObject,
                tickProperty,
                out jsTickFunction
            );

        CheckJs(
            error,
            "JsGetProperty(RenderFrame)"
        );


        error =
            JsAddRef(
                jsTickFunction,
                out ignoredRefCount
            );

        CheckJs(
            error,
            "JsAddRef(RenderFrame)"
        );
    }


    // ========================================================
    // Run startup script
    // ========================================================

    private static void RunScript(
        string source,
        string sourceUrl
    )
    {
        IntPtr result;


        uint error =
            JsRunScript(
                source,
                sourceContext++,
                sourceUrl,
                out result
            );


        if (error != JsNoError)
        {
            throw new Exception(
                FormatJsError(
                    error,
                    "JsRunScript: " +
                    sourceUrl
                )
            );
        }
    }


    // ========================================================
    // Per-frame render
    // ========================================================

    private static void RenderAndBlit()
    {
        if (!running && hwnd != IntPtr.Zero)
            return;


        if (rendering)
            return;


        if (jsTickFunction == IntPtr.Zero)
            return;


        rendering = true;


        try
        {
            // ------------------------------------------------
            // Pass real elapsed time (seconds) into JavaScript.
            // ------------------------------------------------

            double elapsedSeconds =
                animationClock.Elapsed.TotalSeconds;


            IntPtr jsTime;


            uint error =
                JsDoubleToNumber(
                    elapsedSeconds,
                    out jsTime
                );


            if (error != JsNoError)
            {
                fatalError =
                    FormatJsError(
                        error,
                        "JsDoubleToNumber"
                    );


                running = false;


                if (hwnd != IntPtr.Zero)
                {
                    DestroyWindow(
                        hwnd
                    );
                }


                return;
            }


            // arguments[0] = JavaScript `this`
            // arguments[1] = elapsed time in seconds
            IntPtr[] arguments =
                new IntPtr[2];

            arguments[0] =
                jsUndefined;

            arguments[1] =
                jsTime;


            IntPtr result;


            error =
                JsCallFunction(
                    jsTickFunction,
                    arguments,
                    2,
                    out result
                );


            if (error != JsNoError)
            {
                fatalError =
                    FormatJsError(
                        error,
                        "RenderFrame"
                    );


                running = false;


                if (hwnd != IntPtr.Zero)
                {
                    DestroyWindow(
                        hwnd
                    );
                }


                return;
            }


            BlitCurrentFramebuffer();
        }
        catch (Exception ex)
        {
            // Never let a managed exception escape through
            // native WndProc.
            fatalError =
                "Render failure: " +
                ex.Message;


            running = false;


            if (hwnd != IntPtr.Zero)
            {
                DestroyWindow(
                    hwnd
                );
            }
        }
        finally
        {
            rendering = false;
        }
    }


    // ========================================================
    // GDI blit
    // ========================================================

    private static void BlitCurrentFramebuffer()
    {
        if (hwnd == IntPtr.Zero)
            return;


        RECT rect;


        if (!GetClientRect(
            hwnd,
            out rect
        ))
        {
            return;
        }


        int destinationWidth =
            rect.right -
            rect.left;


        int destinationHeight =
            rect.bottom -
            rect.top;


        // Minimized.
        if (
            destinationWidth <= 0 ||
            destinationHeight <= 0
        )
        {
            return;
        }


        IntPtr dc =
            GetDC(
                hwnd
            );


        if (dc == IntPtr.Zero)
            return;


        try
        {
            BITMAPINFOHEADER info =
                new BITMAPINFOHEADER();


            info.biSize =
                (uint)Marshal.SizeOf(
                    typeof(BITMAPINFOHEADER)
                );


            info.biWidth =
                sourceWidth;


            // Negative height = top-down.
            info.biHeight =
                -sourceHeight;


            info.biPlanes =
                1;


            info.biBitCount =
                32;


            info.biCompression =
                BI_RGB;


            info.biSizeImage =
                (uint)framebufferBytes;


            StretchDIBits(
                dc,

                // Destination
                0,
                0,
                destinationWidth,
                destinationHeight,

                // Source
                0,
                0,
                sourceWidth,
                sourceHeight,

                // SAME MEMORY JavaScript writes
                framebuffer,

                ref info,

                DIB_RGB_COLORS,
                SRCCOPY
            );
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
    // Window procedure
    // ========================================================

    private static IntPtr WindowProc(
        IntPtr window,
        uint message,
        UIntPtr wParam,
        IntPtr lParam
    )
    {
        try
        {
            switch (message)
            {
                // --------------------------------------------
                // Windows is about to enter its modal titlebar
                // move/resize loop.
                //
                // Our normal outer render loop will temporarily
                // stop receiving control.
                //
                // Enable WM_TIMER ONLY for that period.
                // --------------------------------------------

                case WM_ENTERSIZEMOVE:
                {
                    insideSizeMove = true;


                    SetTimer(
                        window,
                        new UIntPtr(1),
                        1,
                        IntPtr.Zero
                    );


                    return IntPtr.Zero;
                }


                // --------------------------------------------
                // Windows' modal loop is over.
                //
                // Stop timer and go back to the uncapped outer
                // rendering loop.
                // --------------------------------------------

                case WM_EXITSIZEMOVE:
                {
                    KillTimer(
                        window,
                        new UIntPtr(1)
                    );


                    insideSizeMove = false;


                    return IntPtr.Zero;
                }


                // --------------------------------------------
                // While moving/resizing, Windows' internal modal
                // loop continues dispatching WM_TIMER.
                //
                // This is why the animation keeps running while
                // dragging WITHOUT another thread.
                // --------------------------------------------

                case WM_TIMER:
                {
                    if (insideSizeMove)
                    {
                        RenderAndBlit();
                    }


                    return IntPtr.Zero;
                }


                // --------------------------------------------
                // Repaint current framebuffer.
                //
                // Do NOT advance animation merely because the
                // window needs repainting.
                // --------------------------------------------

                case WM_PAINT:
                {
                    PAINTSTRUCT ps;


                    BeginPaint(
                        window,
                        out ps
                    );


                    EndPaint(
                        window,
                        ref ps
                    );


                    BlitCurrentFramebuffer();


                    return IntPtr.Zero;
                }


                case WM_ERASEBKGND:
                {
                    // We cover the whole client area.
                    return new IntPtr(1);
                }


                case WM_CLOSE:
                {
                    KillTimer(
                        window,
                        new UIntPtr(1)
                    );


                    DestroyWindow(
                        window
                    );


                    return IntPtr.Zero;
                }


                case WM_DESTROY:
                {
                    hwnd = IntPtr.Zero;

                    running = false;


                    PostQuitMessage(0);


                    return IntPtr.Zero;
                }
            }


            return DefWindowProc(
                window,
                message,
                wParam,
                lParam
            );
        }
        catch (Exception ex)
        {
            // Never throw through unmanaged WndProc.
            fatalError =
                "WndProc error: " +
                ex.Message;


            running = false;


            return DefWindowProc(
                window,
                message,
                wParam,
                lParam
            );
        }
    }


    // ========================================================
    // Create normal native window
    // ========================================================

    private static IntPtr CreateFramebufferWindow(
        string title,
        int clientWidth,
        int clientHeight
    )
    {
        IntPtr module =
            GetModuleHandle(
                null
            );


        WNDCLASSEX windowClass =
            new WNDCLASSEX();


        windowClass.cbSize =
            (uint)Marshal.SizeOf(
                typeof(WNDCLASSEX)
            );


        windowClass.style =
            CS_HREDRAW |
            CS_VREDRAW;


        windowClass.lpfnWndProc =
            wndProcDelegate;


        windowClass.hInstance =
            module;


        windowClass.hCursor =
            LoadCursor(
                IntPtr.Zero,
                new IntPtr(IDC_ARROW)
            );


        windowClass.hbrBackground =
            IntPtr.Zero;


        windowClass.lpszClassName =
            WindowClassName;


        ushort atom =
            RegisterClassEx(
                ref windowClass
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


        RECT rectangle =
            new RECT();


        rectangle.left   = 0;
        rectangle.top    = 0;
        rectangle.right  = clientWidth;
        rectangle.bottom = clientHeight;


        if (!AdjustWindowRect(
            ref rectangle,
            style,
            false
        ))
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error()
            );
        }


        int windowWidth =
            rectangle.right -
            rectangle.left;


        int windowHeight =
            rectangle.bottom -
            rectangle.top;


        IntPtr window =
            CreateWindowEx(
                0,
                WindowClassName,
                title,
                style,

                CW_USEDEFAULT,
                CW_USEDEFAULT,

                windowWidth,
                windowHeight,

                IntPtr.Zero,
                IntPtr.Zero,

                module,
                IntPtr.Zero
            );


        if (window == IntPtr.Zero)
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error()
            );
        }


        return window;
    }


    // ========================================================
    // Chakra errors
    // ========================================================

    private static void CheckJs(
        uint error,
        string operation
    )
    {
        if (error == JsNoError)
            return;


        throw new Exception(
            FormatJsError(
                error,
                operation
            )
        );
    }


    private static string FormatJsError(
        uint error,
        string operation
    )
    {
        string message =
            operation +
            " failed with Chakra error 0x" +
            error.ToString("X8");


        try
        {
            IntPtr exception;


            uint getError =
                JsGetAndClearException(
                    out exception
                );


            if (
                getError == JsNoError &&
                exception != IntPtr.Zero
            )
            {
                IntPtr exceptionString;


                if (
                    JsConvertValueToString(
                        exception,
                        out exceptionString
                    ) == JsNoError
                )
                {
                    IntPtr chars;
                    UIntPtr length;


                    if (
                        JsStringToPointer(
                            exceptionString,
                            out chars,
                            out length
                        ) == JsNoError
                    )
                    {
                        ulong len64 =
                            length.ToUInt64();


                        if (len64 <= Int32.MaxValue)
                        {
                            string text =
                                Marshal.PtrToStringUni(
                                    chars,
                                    (int)len64
                                );


                            if (!String.IsNullOrEmpty(text))
                            {
                                message +=
                                    ": " +
                                    text;
                            }
                        }
                    }
                }
            }
        }
        catch
        {
            // Preserve original Chakra error if projecting the
            // exception itself fails.
        }


        return message;
    }


    // ========================================================
    // Clear framebuffer
    // ========================================================

    private static void ZeroFramebuffer()
    {
        // AllocHGlobal isn't guaranteed to return zeroed memory.
        //
        // Do this only once at startup.
        byte[] zeroChunk =
            new byte[
                Math.Min(
                    framebufferBytes,
                    65536
                )
            ];


        int offset = 0;


        while (offset < framebufferBytes)
        {
            int count =
                Math.Min(
                    zeroChunk.Length,
                    framebufferBytes - offset
                );


            Marshal.Copy(
                zeroChunk,
                0,
                IntPtr.Add(
                    framebuffer,
                    offset
                ),
                count
            );


            offset += count;
        }
    }


    // ========================================================
    // Cleanup
    // ========================================================

    private static void Cleanup()
    {
        running = false;

        animationClock.Stop();


        if (hwnd != IntPtr.Zero)
        {
            KillTimer(
                hwnd,
                new UIntPtr(1)
            );


            DestroyWindow(
                hwnd
            );


            hwnd = IntPtr.Zero;
        }


        // Chakra refs must be released while a context is active.
        if (jsContext != IntPtr.Zero)
        {
            try
            {
                JsSetCurrentContext(
                    jsContext
                );


                uint ignored;


                if (jsTickFunction != IntPtr.Zero)
                {
                    JsRelease(
                        jsTickFunction,
                        out ignored
                    );


                    jsTickFunction =
                        IntPtr.Zero;
                }


                if (jsArrayBuffer != IntPtr.Zero)
                {
                    JsRelease(
                        jsArrayBuffer,
                        out ignored
                    );


                    jsArrayBuffer =
                        IntPtr.Zero;
                }
            }
            catch
            {
            }


            JsSetCurrentContext(
                IntPtr.Zero
            );


            jsContext =
                IntPtr.Zero;
        }


        if (jsRuntime != IntPtr.Zero)
        {
            JsDisposeRuntime(
                jsRuntime
            );


            jsRuntime =
                IntPtr.Zero;
        }


        // IMPORTANT:
        //
        // Dispose Chakra BEFORE freeing the external ArrayBuffer
        // memory.
        if (framebuffer != IntPtr.Zero)
        {
            Marshal.FreeHGlobal(
                framebuffer
            );


            framebuffer =
                IntPtr.Zero;
        }
    }


    // ========================================================
    // Native structures
    // ========================================================

    private delegate IntPtr WndProc(
        IntPtr hwnd,
        uint message,
        UIntPtr wParam,
        IntPtr lParam
    );


    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int x;
        public int y;
    }


    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }


    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
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
    private struct WNDCLASSEX
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
    private struct PAINTSTRUCT
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


    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFOHEADER
    {
        public uint biSize;

        public int biWidth;
        public int biHeight;

        public ushort biPlanes;
        public ushort biBitCount;

        public uint biCompression;
        public uint biSizeImage;

        public int biXPelsPerMeter;
        public int biYPelsPerMeter;

        public uint biClrUsed;
        public uint biClrImportant;
    }


    // ========================================================
    // Win32
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


    [DllImport(
        "user32.dll",
        SetLastError = true
    )]
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
        CharSet = CharSet.Unicode
    )]
    private static extern bool PeekMessage(
        out MSG lpMsg,
        IntPtr hWnd,
        uint min,
        uint max,
        uint removeMsg
    );


    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(
        ref MSG lpMsg
    );


    [DllImport(
        "user32.dll",
        CharSet = CharSet.Unicode
    )]
    private static extern IntPtr DispatchMessage(
        ref MSG lpMsg
    );


    [DllImport("user32.dll")]
    private static extern bool GetClientRect(
        IntPtr hWnd,
        out RECT lpRect
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


    [DllImport("user32.dll")]
    private static extern IntPtr BeginPaint(
        IntPtr hWnd,
        out PAINTSTRUCT lpPaint
    );


    [DllImport("user32.dll")]
    private static extern bool EndPaint(
        IntPtr hWnd,
        ref PAINTSTRUCT lpPaint
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

        IntPtr lpBits,

        ref BITMAPINFOHEADER lpBitsInfo,

        uint iUsage,
        uint rop
    );


    // ========================================================
    // Windows Chakra JSRT
    // ========================================================

    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsCreateRuntime(
        uint attributes,
        IntPtr threadService,
        out IntPtr runtime
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsDisposeRuntime(
        IntPtr runtime
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsCreateContext(
        IntPtr runtime,
        out IntPtr newContext
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsSetCurrentContext(
        IntPtr context
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsGetGlobalObject(
        out IntPtr globalObject
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CharSet = CharSet.Unicode,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsGetPropertyIdFromName(
        string name,
        out IntPtr propertyId
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsSetProperty(
        IntPtr obj,
        IntPtr propertyId,
        IntPtr value,

        [MarshalAs(UnmanagedType.I1)]
        bool useStrictRules
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsGetProperty(
        IntPtr obj,
        IntPtr propertyId,
        out IntPtr value
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsCreateExternalArrayBuffer(
        IntPtr data,
        uint byteLength,
        IntPtr finalizeCallback,
        IntPtr callbackState,
        out IntPtr result
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CharSet = CharSet.Unicode,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsRunScript(
        string script,
        ulong sourceContext,
        string sourceUrl,
        out IntPtr result
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsGetUndefinedValue(
        out IntPtr undefinedValue
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsDoubleToNumber(
        double doubleValue,
        out IntPtr value
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsCallFunction(
        IntPtr function,

        [In]
        IntPtr[] arguments,

        ushort argumentCount,
        out IntPtr result
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsAddRef(
        IntPtr reference,
        out uint count
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsRelease(
        IntPtr reference,
        out uint count
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsGetAndClearException(
        out IntPtr exception
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsConvertValueToString(
        IntPtr value,
        out IntPtr stringValue
    );


    [DllImport(
        "chakra.dll",
        ExactSpelling = true,
        CallingConvention = CallingConvention.Winapi
    )]
    private static extern uint JsStringToPointer(
        IntPtr value,
        out IntPtr stringValue,
        out UIntPtr stringLength
    );
}
"@


Add-Type -TypeDefinition $Source


# ============================================================
# Start
# ============================================================

Write-Host ""
Write-Host "JavaScript : $JSFile"
Write-Host "Framebuffer : $Width x $Height"
Write-Host "Engine      : Windows chakra.dll"
Write-Host "Transport   : shared external ArrayBuffer (zero-copy)"
Write-Host ""


try {

    [ChakraFramebufferHost]::Run(
        $JSFile,
        $Width,
        $Height
    )

}
catch [System.DllNotFoundException] {

    throw @"
chakra.dll could not be loaded.

This version requires the Windows Chakra JSRT engine and
JsCreateExternalArrayBuffer support.
"@

}
catch [System.EntryPointNotFoundException] {

    throw @"
The installed chakra.dll does not expose one of the required
JSRT functions.

JsCreateExternalArrayBuffer requires Windows 10 version 1607
(build 14393) or newer.
"@

}
