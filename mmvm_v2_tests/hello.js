var dlsym = get_dlsym();
var puts = ffi_call(dlsym, 0, "puts");

ffi_call(puts, "Hello, world!");
