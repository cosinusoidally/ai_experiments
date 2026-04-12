#define main ansi_orig_main
#include "mawkcc_orig.c"
#undef main

int self_main(int argc, char **argv, int arg1);

int main(int argc, char **argv)
{
    return self_main(argc, argv, 0);
}

int ansi_is_dash_c(const char *s)
{
    return strcmp(s, "-c") == 0;
}

int ansi_usage(const char *program)
{
    fprintf(stderr, "usage: %s [-c] source\n", program);
    return 1;
}

int ansi_compile(const char *source_path, int object_output)
{
    char *argv[3];

    argv[0] = (char *)"mawkcc.exe";
    if (object_output) {
        argv[1] = (char *)"-c";
        argv[2] = (char *)source_path;
        return ansi_orig_main(3, argv);
    }

    argv[1] = (char *)source_path;
    return ansi_orig_main(2, argv);
}
