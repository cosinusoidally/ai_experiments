function init() {
  support_code = document.createElement("script");
  support_code.src = "scripts/mawkcc-js-runner.js";
  document.body.appendChild(support_code);
}

window.onload = function() {
  os = {};
  os.file = {};
  os.file.readFile = function(x) {
    console.log("readFile not impl: "+x);
    if(x === "mawkcc_self.c") {
      console.log("readFile reading: "+x);
    } else {
      console.log("readFile is fussy about filenames: "+x);
      throw "error";
    }
    return [0,0,0];
  }
  scriptArgs = ["mawkcc_self.c","mawkcc.exe"];
  os.getenv = function(x) {
    console.log("os.getenv: "+x);
    return 0;
  }
  load = function(x) {
    console.log("load dummy impl: "+x);
  }

  printErr = function(x) {
    console.log("printErr: "+x);
    throw "error";
  }

  init();
}
