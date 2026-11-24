#include "js.h"
#include <stdio.h>
#include <string.h>
static int twice(VM *m,int argc,void *user) {
    double factor=*(double *)user;
    if(argc!=1 || js_arg_type(m,0)!=JS_NUMBER)return 0;
    js_return_number(m,js_arg_number(m,0)*factor);
    return 1;
}
int main(void) {
    VM *m=js_new();double factor=2;int i;
    if(!m||!js_register(m,"twice",twice,&factor))return 1;
    if(!js_eval(m,"var v=twice(21);assert(v===42);var f=function(x){return x+v;};"))return 2;
    for(i=0;i<1000;i++)if(!js_eval(m,"assert(f(8)===50);(function(){return {};})();"))return 3;
    if(js_eval(m,"var = ;"))return 4;
    if(js_eval(m,"throw 1;"))return 5;
    js_set_budget(m,1000);
    if(js_eval(m,"while(true){}"))return 6;
    if(!strstr(js_error(m),"instruction limit"))return 7;
    js_set_budget(m,0);
    if(!js_eval(m,"assert(twice(5)===10);"))return 8;
    js_free(m);puts("embedding tests passed");return 0;
}
