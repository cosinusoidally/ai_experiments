Option Explicit
' Bounded hex/binary transport. TextStream is used only after checking that
' this locale's single-byte Chr/Asc mapping round-trips every byte. Reject
' unsupported code pages rather than silently corrupt an executable.
Dim fs, input, output, mode, source, target, part, result, i, n, expected
Set fs = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count <> 3 Then Fail "expected hex2bin|bin2hex INPUT OUTPUT"
mode = WScript.Arguments(0)
source = WScript.Arguments(1)
target = WScript.Arguments(2)
If mode <> "hex2bin" And mode <> "bin2hex" Then Fail "unknown conversion mode"
For n = 0 To 255
    If Asc(Chr(n)) <> n Then Fail "binary transport requires a reversible single-byte code page"
Next
If fs.FileExists(target) Then Fail "output already exists"
Set input = fs.OpenTextFile(source, 1, False, 0)
Set output = fs.CreateTextFile(target, False, False)
expected = 0
Do Until input.AtEndOfStream
    part = input.Read(4096)
    result = ""
    If mode = "hex2bin" Then
        If Len(part) Mod 2 <> 0 Then Fail "odd hex input length"
        For i = 1 To Len(part) Step 2
            n = CLng("&H" & Mid(part, i, 2))
            If n < 0 Or n > 255 Then Fail "invalid hex byte"
            result = result & Chr(n)
        Next
    Else
        For i = 1 To Len(part)
            n = Asc(Mid(part, i, 1))
            If n < 0 Or n > 255 Then Fail "input cannot be represented as single bytes"
            result = result & Right("0" & Hex(n), 2)
        Next
    End If
    output.Write result
    expected = expected + Len(result)
Loop
input.Close
output.Close
If fs.GetFile(target).Size <> expected Then Fail "binary transport changed the byte count"
WScript.Quit 0
Sub Fail(message)
    WScript.StdErr.WriteLine "WSH binary helper: " & message
    WScript.Quit 1
End Sub
