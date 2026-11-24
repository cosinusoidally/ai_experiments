/* Test-only bytecode serializer. Includes the original implementation unchanged. */
#include "../js.c"
static void value(Val v) {
    size_t i;
    printf("%d:", v.t);
    if(v.t==NUM||v.t==BOOL)printf("%.17g",v.n);
    if(v.t==STR)for(i=0;i<slen(v);i++)printf("%02x",(unsigned char)chars(v)[i]);
}
static void dump(Fun *f) {
    int i;
    printf("F "); value(f->name); printf(" %d %d %d %d %d\n",f->argc,f->nv,f->nh,f->nhd,f->n);
    for(i=0;i<f->argc;i++){printf("P ");value(f->params[i]);puts("");}
    for(i=0;i<f->nv;i++){printf("V ");value(f->vars[i]);puts("");}
    for(i=0;i<f->nh;i++){printf("H ");value(f->names[i]);puts("");dump(f->hoist[i]);}
    for(i=0;i<f->nhd;i++){
        Handler *h=&f->handlers[i];
        printf("E %d %d %d %d %d ",h->start,h->end,h->target,h->finish,h->iter);value(h->name);puts("");
    }
    for(i=0;i<f->n;i++){
        Ins *in=&f->code[i];printf("I %d %d ",in->op,in->a);value(in->v);puts("");
        if(in->fn)dump(in->fn);
    }
    puts("END");
}
int main(void) {
    VM *m=js_new();char *s;size_t n=0,cap=4096;int c;
    if(!m)return 1;
    s=malloc(cap);if(!s)return 1;
    while((c=getchar())!=EOF){if(n+1==cap){cap*=2;s=realloc(s,cap);if(!s)return 1;}s[n++]=(char)c;}
    s[n]=0;if(setjmp(m->fail)){fprintf(stderr,"%s\n",js_error(m));free(s);js_free(m);return 1;}
    dump(compile(m,s));free(s);js_free(m);return 0;
}
