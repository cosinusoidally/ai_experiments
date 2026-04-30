BEGIN {
    if (ARGC != 3) {
        print "usage: mawk -f extract-tarball.awk <tarball> <destdir>" > "/dev/stderr"
        exit 1
    }

    tarball = ARGV[1]
    destdir = ARGV[2]
    delete ARGV[1]
    delete ARGV[2]

    root = ENVIRON["BOOTSTRAP_ROOT"]
    if (root == "") {
        "pwd" | getline root
        close("pwd")
    }
    unbz2_script = root "/extract-bz2.awk"
    untar_script = root "/extract-tar.awk"

    if (!is_file(tarball)) {
        fail("missing tarball: " tarball)
    }
    if (!is_file(unbz2_script)) {
        fail("missing bz2 extractor: " unbz2_script)
    }
    if (!is_file(untar_script)) {
        fail("missing tar extractor: " untar_script)
    }

    run("mkdir -p \"" destdir "\"")

    if (tarball ~ /\.tar\.bz2$/) {
        tmp_tar = destdir "/.__extract.tar"
        run("mawk -f \"" unbz2_script "\" \"" tarball "\" \"" tmp_tar "\"")
        run("mawk -f \"" untar_script "\" \"" tmp_tar "\" \"" destdir "\"")
        run("rm -f \"" tmp_tar "\"")
    } else if (tarball ~ /\.tar$/) {
        run("mawk -f \"" untar_script "\" \"" tarball "\" \"" destdir "\"")
    } else {
        fail("unsupported tarball format: " tarball)
    }
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

function is_file(path) {
    return system("[ -f \"" path "\" ]") == 0
}
