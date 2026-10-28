/* Runs in the standalone VM. libc profil samples the native interpreter;
 * no guest timer, thread, or callback is needed while compilation is busy. */
var profileFFI = require("../host_ffi.js");
var profileHeader = require("../aot/backend_x86.js").StandaloneHeaderFields;
var profileCalls = new profileFFI();
var profileImage = __guestVMStandaloneImageBase;
var profileCodeLength = peek32(profileImage + profileHeader.codeLength) >>> 0;
var profileBytes = profileCodeLength + 2;
var profileBuffer = profileCalls.call(profileCalls.resolve("calloc"), [profileBytes, 1]);
if (!profileBuffer) throw new Error("sample allocation failed");
if (profileCalls.call(profileCalls.resolve("profil"), [profileBuffer, profileBytes,
        profileImage + (peek32(profileImage + profileHeader.codeOffset) >>> 0),
        65536]) !== 0) throw new Error("profil failed");
print("NATIVE_PROFILE " + (profileBuffer >>> 0) + " " + profileBytes + " " +
    (peek32(profileImage + profileHeader.sourceHash) >>> 0));
var profileProgram = arguments[0];
arguments = arguments.slice(1);
load(profileProgram);
