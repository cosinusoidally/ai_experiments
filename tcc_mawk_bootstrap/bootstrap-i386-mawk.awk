BEGIN {
    root = ENVIRON["BOOTSTRAP_ROOT"]
    if (root == "") {
        "pwd" | getline root
        close("pwd")
        if (root == "") {
            print "could not determine working directory" > "/dev/stderr"
            exit 1
        }
    }

    tarball = root "/tcc-0.9.27.tar.bz2"
    extract_script = root "/extract-tarball.awk"
    bz2_script = root "/extract-bz2.awk"
    artifacts_root = root "/artifacts"
    build_root = artifacts_root "/bootstrap-i386-mawk"
    source_root = build_root "/source"
    source_dir = source_root "/tcc-0.9.27"
    common_tccdir = build_root "/common/lib/tcc"
    common_include = common_tccdir "/include"
    run_wrapper = ENVIRON["RUN_I386"]
    if (run_wrapper == "" && is_file(root "/run-i386.sh")) {
        run_wrapper = root "/run-i386.sh"
    }
    use_awk_extract = ENVIRON["USE_AWK_EXTRACT"]
    jobs = ENVIRON["JOBS"]
    if (jobs == "") {
        jobs = 1
    }
    bootstrap_cflags = "-m32 -DCONFIG_TCCBOOT -DTCC_TARGET_I386 -DONE_SOURCE=0"
    gcc_cflags = bootstrap_cflags " -I. -I\"" source_dir "\" -Wdeclaration-after-statement -fno-strict-aliasing -Wno-pointer-sign -Wno-sign-compare -Wno-unused-result"
    tcc_cflags = bootstrap_cflags " -I. -I\"" source_dir "\""
    i386_crt_prefix = "/usr/lib32:/lib32"
    i386_lib_paths = "/usr/lib32:/lib32:/usr/lib/i386-linux-gnu:/lib/i386-linux-gnu"
    i386_libdl = first_existing("/lib32/libdl.so.2 /usr/lib32/libdl.so.2 /lib/i386-linux-gnu/libdl.so.2 /usr/lib/i386-linux-gnu/libdl.so.2")
    if (i386_libdl == "") {
        fail("could not find 32-bit libdl.so.2")
    }
    link_libs = "-lm \"" i386_libdl "\" -m32"

    compiler_sources = "tcc.c libtcc.c tccpp.c tccgen.c tccelf.c tccasm.c tccrun.c i386-gen.c i386-link.c i386-asm.c"
    compiler_count = split(compiler_sources, compiler_list, " ")

    require_cmd("gcc")
    require_cmd("ar")
    require_cmd("cmp")
    require_cmd("mawk")
    require_cmd("base64")
    require_cmd("tar")
    if (use_awk_extract == "1") {
        if (!is_file(bz2_script)) {
            fail("missing bz2 extractor script: " bz2_script)
        }
        if (!is_file(extract_script)) {
            fail("missing extractor script: " extract_script)
        }
    }
    if (run_wrapper != "") {
        require_cmd(run_wrapper)
    }

    if (!is_file(tarball)) {
        fail("missing tarball: " tarball)
    }

    run("rm -rf \"" build_root "\"")
    if (use_awk_extract == "1") {
        run("mawk -f \"" extract_script "\" \"" tarball "\" \"" source_root "\"")
    } else {
        run("mkdir -p \"" source_root "\"")
        run("tar -xjf \"" tarball "\" -C \"" source_root "\"")
    }
    patch_libtcc_version_parse()
    version = read_first_line(source_dir "/VERSION")
    run("mkdir -p \"" common_include "\"")
    run("cp -f \"" source_dir "/include\"/*.h \"" common_include "\"")
    run("cp -f \"" source_dir "/tcclib.h\" \"" common_include "\"")

    build_stage0()
    write_stage_cc(build_root "/stage1-cc.sh", build_root "/stage0/tcc")
    build_stage("stage1", build_root "/stage1-cc.sh")
    write_stage_cc(build_root "/stage2-cc.sh", build_root "/stage1/tcc")
    build_stage("stage2", build_root "/stage2-cc.sh")

    if (system("cmp -s \"" build_root "/stage1/tcc\" \"" build_root "/stage2/tcc\"") != 0) {
        fail("bootstrap complete: stage1 and stage2 tcc binaries differ")
    }

    print "bootstrap complete: stage1 and stage2 tcc binaries match"
}

function read_first_line(path, line, rc) {
    rc = (getline line < path)
    close(path)
    if (rc <= 0) {
        fail("could not read " path)
    }
    return line
}

function fail(msg) {
    print msg > "/dev/stderr"
    exit 1
}

function run(cmd, rc) {
    print cmd
    rc = system(cmd)
    if (rc != 0) {
        fail("command failed: " cmd)
    }
}

function require_cmd(cmd) {
    if (cmd ~ /^\//) {
        if (system("[ -x \"" cmd "\" ]") != 0) {
            fail("missing required tool: " cmd)
        }
        return
    }
    if (system("command -v \"" cmd "\" >/dev/null 2>&1") != 0) {
        fail("missing required tool: " cmd)
    }
}

function is_dir(path) {
    return system("[ -d \"" path "\" ]") == 0
}

function is_file(path) {
    return system("[ -f \"" path "\" ]") == 0
}

function base_no_ext(name, out) {
    out = name
    sub(/^.*\//, "", out)
    sub(/\.[^.]+$/, "", out)
    return out
}

function first_existing(list,    n, items, i) {
    n = split(list, items, " ")
    for (i = 1; i <= n; ++i) {
        if (is_file(items[i])) {
            return items[i]
        }
    }
    return ""
}

function patch_libtcc_version_parse(    src, tmp, cmd) {
    src = source_dir "/libtcc.c"
    tmp = src ".new"
    cmd = "mawk '"
    cmd = cmd "index($0, \"sscanf(TCC_VERSION, \\\"%d.%d.%d\\\", &a, &b, &c);\") {"
    cmd = cmd " print \"        char *p;\";"
    cmd = cmd " print \"        a = strtol(TCC_VERSION, &p, 10);\";"
    cmd = cmd " print \"        if (*p == '\\''.'\\'') {\";"
    cmd = cmd " print \"            b = strtol(p + 1, &p, 10);\";"
    cmd = cmd " print \"            if (*p == '\\''.'\\'')\";"
    cmd = cmd " print \"                c = strtol(p + 1, 0, 10);\";"
    cmd = cmd " print \"        }\";"
    cmd = cmd " next }"
    cmd = cmd " { print }' \"" src "\" > \"" tmp "\""
    run(cmd)
    run("mv \"" tmp "\" \"" src "\"")
}

function write_config_h(stage_dir,    f) {
    f = stage_dir "/config.h"
    print "/* Automatically generated by bootstrap-i386-mawk.awk */" > f
    print "#ifndef CONFIG_TCCDIR" >> f
    print "# define CONFIG_TCCDIR \"" common_tccdir "\"" >> f
    print "#endif" >> f
    print "#ifndef CONFIG_TCC_CRTPREFIX" >> f
    print "# define CONFIG_TCC_CRTPREFIX \"" i386_crt_prefix "\"" >> f
    print "#endif" >> f
    print "#ifndef CONFIG_TCC_LIBPATHS" >> f
    print "# define CONFIG_TCC_LIBPATHS \"" i386_lib_paths "\"" >> f
    print "#endif" >> f
    print "#define TCC_VERSION \"" version "\"" >> f
    close(f)
}

function write_stage_cc(path, tcc_path,    f) {
    f = path
    print "#!/bin/sh" > f
    print "set -eu" > f
    if (run_wrapper != "") {
        print "exec \"" run_wrapper "\" \"" tcc_path "\" \"-B" common_tccdir "\" \"$@\"" > f
    } else {
        print "exec \"" tcc_path "\" \"-B" common_tccdir "\" \"$@\"" > f
    }
    close(f)
    run("chmod +x \"" path "\"")
}

function run_i386_cmd(stage_dir, args, cmd) {
    if (run_wrapper != "") {
        cmd = "cd \"" stage_dir "\" && \"" run_wrapper "\" \"" stage_dir "/tcc\" \"-B" common_tccdir "\" " args
    } else {
        cmd = "cd \"" stage_dir "\" && \"" stage_dir "/tcc\" \"-B" common_tccdir "\" " args
    }
    run(cmd)
}

function populate_prefix(stage_dir) {
    run("mkdir -p \"" stage_dir "/prefix/bin\" \"" stage_dir "/prefix/lib\" \"" stage_dir "/prefix/include\"")
    run("cp -f \"" stage_dir "/tcc\" \"" stage_dir "/prefix/bin/tcc\"")
    run("cp -f \"" stage_dir "/libtcc.a\" \"" stage_dir "/prefix/lib/libtcc.a\"")
    run("cp -f \"" source_dir "/libtcc.h\" \"" stage_dir "/prefix/include/libtcc.h\"")
    run("mkdir -p \"" stage_dir "/prefix/lib\"")
    run("ln -sfn \"" common_tccdir "\" \"" stage_dir "/prefix/lib/tcc\"")
}

function build_libtcc1_with_tcc(stage_dir) {
    run("mkdir -p \"" stage_dir "/lib\"")
    run_i386_cmd(stage_dir, "-c \"" source_dir "/lib/libtcc1.c\" -o lib/libtcc1.o")
    run_i386_cmd(stage_dir, "-c \"" source_dir "/lib/alloca86.S\" -o lib/alloca86.o")
    run_i386_cmd(stage_dir, "-c \"" source_dir "/lib/alloca86-bt.S\" -o lib/alloca86-bt.o")
    run("cd \"" stage_dir "\" && ar rcs libtcc1.a lib/libtcc1.o lib/alloca86.o lib/alloca86-bt.o")
}

function build_compiler(stage_dir, cc_cmd, cflags,    i, src, obj, cmd) {
    for (i = 1; i <= compiler_count; ++i) {
        src = compiler_list[i]
        obj = stage_dir "/" base_no_ext(src) ".o"
        cmd = "cd \"" stage_dir "\" && " cc_cmd " -o \"" obj "\" -c \"" source_dir "/" src "\" " cflags
        run(cmd)
    }

    run("cd \"" stage_dir "\" && ar rcs libtcc.a libtcc.o tccpp.o tccgen.o tccelf.o tccasm.o tccrun.o i386-gen.o i386-link.o i386-asm.o")
    run("cd \"" stage_dir "\" && " cc_cmd " -o \"" stage_dir "/tcc\" \"" stage_dir "/tcc.o\" \"" stage_dir "/libtcc.a\" " link_libs)
}

function build_stage0(stage_dir) {
    stage_dir = build_root "/stage0"
    run("mkdir -p \"" stage_dir "\"")
    write_config_h(stage_dir)
    build_compiler(stage_dir, "gcc", gcc_cflags)
    build_libtcc1_with_tcc(stage_dir)
    run("cp -f \"" stage_dir "/libtcc1.a\" \"" common_tccdir "/libtcc1.a\"")
    populate_prefix(stage_dir)
}

function build_stage(stage, cc_script, stage_dir) {
    stage_dir = build_root "/" stage
    run("mkdir -p \"" stage_dir "\"")
    write_config_h(stage_dir)
    build_compiler(stage_dir, "\"" cc_script "\"", tcc_cflags)
    build_libtcc1_with_tcc(stage_dir)
    populate_prefix(stage_dir)
}
