# WSH build bring-up

Implementation in progress. Acceptance requires genuine builds from the same
checkout/options to produce bit-identical snapshots and executables under WSH,
Node, js_min and the native guest. No native extension, precompiled compiler,
snapshot-copy shortcut or changes to the existing native memory fast path.

Plan: prove bounded hex/binary transport; provide explicit WSH filesystem,
console/argument/scheduling services; select packed-word emulated memory once
at host construction; reuse the shared JS/x86 kernel backends and serializer;
then validate binary identity, execution and existing-host build performance.

The initial VBScript transport uses FSO with a checked reversible single-byte
code page, because Wine's ADO SaveToFile is unimplemented. Unsupported mappings
must error, never silently substitute bytes. End-to-end all-byte and binary
image comparisons are required in addition to the mapping preflight.
