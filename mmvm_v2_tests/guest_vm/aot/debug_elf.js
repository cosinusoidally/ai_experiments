/* Deterministic ELF32 ET_REL DWARF sidecars. Only .text-relative R_386_32
 * relocations are needed. No native tools or machine load addresses appear. */
(function (root) {
    var Binary = root.GuestVMDebugBinary;
    if (typeof module !== "undefined" && module.exports) Binary = require("./debug_binary.js");
    var E = {headerBytes:52, sectionBytes:40, symbolBytes:16, relocBytes:8,
        relocatable:1, i386:3, progbits:1, symtab:2, strtab:3, nobits:8, rel:9,
        alloc:2, executable:4, sectionSymbol:3, globalFunction:0x12, absoluteRelocation:1};
    var SYMBOL = {name: 0, value: 4, size: 8, info: 12, section: 14};
    var TEXT_SYMBOL = 1, FIRST_FUNCTION_SYMBOL = 2, RELOCATION_SYMBOL_SHIFT = 8;
    var H = {type:16,machine:18,version:20,sectionOffset:32,headerSize:40,
        sectionSize:46,sectionCount:48,namesIndex:50};
    var S = {name:0,type:4,flags:8,address:12,offset:16,size:20,link:24,info:28,align:32,entrySize:36};
    function read32(bytes, offset) {
        if (offset < 0 || offset + 4 > bytes.length) throw new Error("truncated debug ELF");
        return (bytes[offset] | bytes[offset+1]<<8 | bytes[offset+2]<<16 | bytes[offset+3]<<24) >>> 0;
    }
    function build(dwarf) {
        var Writer = Binary.Writer, w = new Writer(), strings = new Writer();
        strings.u8(0);
        var sections = [{}], index;
        function add(name,type,bytes,size,flags,link,info,entrySize) {
            var offset = strings.bytes.length; strings.string(name);
            sections.push({name:offset,type:type,bytes:bytes,size:size === null ? bytes.length : size,
                flags:flags||0,link:link||0,info:info||0,entrySize:entrySize||0});
            return sections.length-1;
        }
        var textIndex = add(".text",E.nobits,[],dwarf.codeLength,E.alloc|E.executable);
        var symbols = new Writer(), symbolNames = new Writer();
        symbolNames.u8(0);
        while (symbols.bytes.length < E.symbolBytes) symbols.u8(0);
        symbols.u32(0); symbols.u32(0); symbols.u32(0);
        symbols.u8(E.sectionSymbol); symbols.u8(0); symbols.u16(textIndex);
        for (index = 0; index < dwarf.functions.length; index++) {
            var fn = dwarf.functions[index];
            symbols.u32(symbolNames.bytes.length); symbolNames.string(fn.name);
            symbols.u32(fn.start); symbols.u32(fn.end - fn.start);
            symbols.u8(E.globalFunction); symbols.u8(0); symbols.u16(textIndex);
        }
        var symbolIndex = add(".symtab",E.symtab,symbols.bytes,null,0,0,2,E.symbolBytes);
        var strIndex = add(".strtab",E.strtab,symbolNames.bytes,null);
        sections[symbolIndex].link = strIndex;
        for (index=0; index<dwarf.sections.length; index++) {
            var source = dwarf.sections[index];
            var target = add(source.name,E.progbits,source.bytes,null);
            if (source.relocations.length) {
                var rel = new Writer(), j=0;
                while (j<source.relocations.length) {
                    rel.u32(source.relocations[j++]);
                    rel.u32((TEXT_SYMBOL << RELOCATION_SYMBOL_SHIFT) | E.absoluteRelocation);
                }
                add(".rel"+source.name,E.rel,rel.bytes,null,0,symbolIndex,target,E.relocBytes);
            }
        }
        var namesIndex=add(".shstrtab",E.strtab,[],0);
        sections[namesIndex].bytes=strings.bytes; sections[namesIndex].size=strings.bytes.length;
        while(w.bytes.length<E.headerBytes)w.u8(0);
        for(index=1;index<sections.length;index++) {
            var section=sections[index]; w.align(4); section.offset=w.bytes.length;
            if(section.type!==E.nobits)w.append(section.bytes);
        }
        w.align(4);var table=w.bytes.length;
        while(w.bytes.length<table+sections.length*E.sectionBytes)w.u8(0);
        for(index=1;index<sections.length;index++) {
            section=sections[index]; var at=table+index*E.sectionBytes;
            w.patch32(at+S.name,section.name); w.patch32(at+S.type,section.type);
            w.patch32(at+S.flags,section.flags); w.patch32(at+S.offset,section.offset);
            w.patch32(at+S.size,section.size); w.patch32(at+S.link,section.link);
            w.patch32(at+S.info,section.info); w.patch32(at+S.align,4);
            w.patch32(at+S.entrySize,section.entrySize);
        }
        var b=w.bytes; b[0]=127;b[1]=69;b[2]=76;b[3]=70;b[4]=1;b[5]=1;b[6]=1;
        b[H.type]=E.relocatable;b[H.machine]=E.i386;w.patch32(H.version,1);
        w.patch32(H.sectionOffset,table);b[H.headerSize]=E.headerBytes;
        b[H.sectionSize]=E.sectionBytes;b[H.sectionCount]=sections.length&255;
        b[H.sectionCount+1]=sections.length>>>8;b[H.namesIndex]=namesIndex;
        return b;
    }
    function relocate(bytes, codeAddress, codeLength) {
        if(read32(bytes,0)!==0x464c457f || bytes[4]!==1 || bytes[5]!==1 ||
            bytes[H.type]!==E.relocatable || bytes[H.machine]!==E.i386) {
            throw new Error("not a kernel debug ELF32 sidecar");
        }
        var table=read32(bytes,H.sectionOffset),count=bytes[H.sectionCount]|bytes[H.sectionCount+1]<<8;
        var namesIndex=bytes[H.namesIndex]|bytes[H.namesIndex+1]<<8;
        if(count<4 || table+count*E.sectionBytes>bytes.length || namesIndex>=count) {
            throw new Error("invalid debug section table");
        }
        var names=read32(bytes,table+namesIndex*E.sectionBytes+S.offset),sections=[],output=[],index;
        function string(at){var value="";while(at<bytes.length&&bytes[at])value+=String.fromCharCode(bytes[at++]);return value;}
        for(index=0;index<count;index++) {
            var at=table+index*E.sectionBytes,type=read32(bytes,at+S.type);
            var offset=read32(bytes,at+S.offset),length=read32(bytes,at+S.size);
            var name=string(names+read32(bytes,at+S.name));
            if(type!==E.nobits && offset+length>bytes.length)throw new Error("truncated debug section");
            var section={name:name,type:type,bytes:bytes.slice(offset,offset+length),
                target:read32(bytes,at+S.info), link:read32(bytes,at+S.link)};
            sections.push(section);
            if(name===".text"&&length!==codeLength)throw new Error("debug kernel size mismatch");
            if(name.indexOf(".debug_")===0)output.push(section);
        }
        for(index=0;index<count;index++) {
            section=sections[index];
            if(section.type===E.rel) {
                var target=sections[section.target],rel=section.bytes,j=0;
                if(!target || target.name.indexOf(".debug_")!==0 || rel.length%E.relocBytes) {
                    throw new Error("invalid kernel debug relocation section");
                }
                while(j<rel.length) {
                    var address=read32(rel,j),kind=read32(rel,j+4); j+=E.relocBytes;
                    if (kind !== ((TEXT_SYMBOL << RELOCATION_SYMBOL_SHIFT) | E.absoluteRelocation)) {
                        throw new Error("unsupported debug relocation");
                    }
                    var value=read32(target.bytes,address)+codeAddress,k=0;
                    while(k<4){target.bytes[address+k++]=value&255;value=Math.floor(value/256);}
                }
            }
        }
        var functions = [], symbols = null, names = null;
        for (index = 0; index < sections.length; index++) {
            if (sections[index].type === E.symtab) {
                symbols = sections[index].bytes;
                var linked = sections[sections[index].link];
                if (!linked || linked.type !== E.strtab) throw new Error("invalid debug symbol string table");
                names = linked.bytes;
            }
        }
        if (!symbols || symbols.length % E.symbolBytes) throw new Error("invalid debug symbol table");
        for (index = FIRST_FUNCTION_SYMBOL * E.symbolBytes; index < symbols.length; index += E.symbolBytes) {
            var nameOffset = read32(symbols, index + SYMBOL.name), symbolName = "";
            while (nameOffset < names.length && names[nameOffset]) {
                symbolName += String.fromCharCode(names[nameOffset++]);
            }
            functions.push({name: symbolName, address: read32(symbols, index + SYMBOL.value) + codeAddress,
                length: read32(symbols, index + SYMBOL.size)});
        }
        return {sections: output, functions: functions};
    }
    var api={build:build,relocate:relocate};
    root.GuestVMDebugELF=api;
    if(typeof module!=="undefined"&&module.exports)module.exports=api;
}(this));
