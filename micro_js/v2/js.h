#include <stddef.h>
typedef struct VM VM;
typedef int (*js_native)(VM *vm, int argc, void *user);
enum js_type { JS_UNDEFINED, JS_NULL, JS_BOOLEAN, JS_NUMBER, JS_STRING, JS_OBJECT };
VM *js_new(void);
int js_eval(VM *m, const char *source);
const char *js_error(VM *m);
void js_free(VM *m);
void js_set_budget(VM *m, unsigned long instructions);
int js_register(VM *m, const char *name, js_native callback, void *user);
/* The following functions may be used only during a native callback. */
int js_arg_type(VM *m, int i);
double js_arg_number(VM *m, int i);
const char *js_arg_string(VM *m, int i, size_t *length);
void js_return_number(VM *m, double n);
void js_return_boolean(VM *m, int n);
void js_return_string(VM *m, const char *s, size_t n);
void js_return_null(VM *m);
