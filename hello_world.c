#include <stdio.h>
#include <string.h>
#include "jsapi.h"

int main(int argc, const char *argv[])
{
    JSRuntime *rt;
    JSContext *cx;
    JSObject *glob;
    jsval rval;
    const char *script = "print('Hello, World from Spidermonkey!');";

    /* Create a JavaScript runtime */
    rt = JS_NewRuntime(8L * 1024L * 1024L);
    if (!rt)
        return 1;

    /* Create a context */
    cx = JS_NewContext(rt, 8192);
    if (!cx) {
        JS_DestroyRuntime(rt);
        return 1;
    }

    /* Create the global object */
    glob = JS_NewObject(cx, NULL, NULL, NULL);
    if (!glob) {
        JS_DestroyContext(cx);
        JS_DestroyRuntime(rt);
        return 1;
    }

    /* Initialize the built-in classes and functions */
    if (!JS_InitStandardClasses(cx, glob)) {
        JS_DestroyContext(cx);
        JS_DestroyRuntime(rt);
        return 1;
    }

    /* Execute the script */
    JS_EvaluateScript(cx, glob, script, strlen(script), "hello.js", 1, &rval);

    /* Clean up */
    JS_DestroyContext(cx);
    JS_DestroyRuntime(rt);

    printf("Hello, World from C!\n");
    return 0;
}