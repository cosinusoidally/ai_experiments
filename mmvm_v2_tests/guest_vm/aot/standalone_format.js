/* Shared on-disk ABI. Keep independent of the compiler and host services. */
(function (root) {
    var format = {
        magic: 0x32535647, version: 2, headerBytes: 128,
        fields: {magic: 0, version: 4, fileLength: 8,
            entryOffset: 12, entryLength: 16, codeOffset: 20, codeLength: 24,
            heapOffset: 28, heapLength: 32, heapCapacity: 36, frameAddress: 40,
            contextAddress: 44, dlsymCellAddress: 48, compilerVersion: 80,
            profileMode: 84, sourceHash: 88}
    };
    root.GuestVMStandaloneFormat = format;
    if (typeof module !== "undefined" && module.exports) module.exports = format;
}(this));
