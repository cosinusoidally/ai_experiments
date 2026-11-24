#include <stdio.h>
#include <stdlib.h>
#include "js.h"
int main(int argc,char **argv) {
    VM *m; FILE *f; char *s,*p; size_t n=0,cap=4096; int c,ok,i;
    m=js_new();if(!m)return 1;
    for(i=1;i<argc||i==1;i++) {
        f=argc>1?fopen(argv[i],"rb"):stdin;
        if(!f){perror(argv[i]);js_free(m);return 1;}
        s=malloc(cap);n=0;if(!s){js_free(m);return 1;}
        while((c=fgetc(f))!=EOF){if(n+1==cap){cap*=2;p=realloc(s,cap);if(!p){free(s);js_free(m);return 1;}s=p;}s[n++]=(char)c;}
        s[n]=0;if(f!=stdin)fclose(f);ok=js_eval(m,s);free(s);
        if(!ok){fprintf(stderr,"%s\n",js_error(m));js_free(m);return 1;}
    }
    js_free(m);return 0;
}
