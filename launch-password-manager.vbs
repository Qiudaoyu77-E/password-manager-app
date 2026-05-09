Set shell = CreateObject("WScript.Shell")
root = "D:\Codex\password-manager"
url = "http://localhost:8787"
shell.CurrentDirectory = root

If Not IsRunning(url) Then
  shell.Run "python -m http.server 8787 --bind 127.0.0.1", 0, False
  For i = 1 To 30
    WScript.Sleep 250
    If IsRunning(url) Then Exit For
  Next
End If

OpenApp url

Function IsRunning(targetUrl)
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 500, 500, 500, 500
  http.open "GET", targetUrl, False
  http.send
  IsRunning = (http.status >= 200 And http.status < 500)
  If Err.Number <> 0 Then
    Err.Clear
    IsRunning = False
  End If
  On Error GoTo 0
End Function

Sub OpenApp(targetUrl)
  edge = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
  edgeAlt = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe"
  If FileExists(edge) Then
    shell.Run Chr(34) & edge & Chr(34) & " --app=" & targetUrl, 1, False
  ElseIf FileExists(edgeAlt) Then
    shell.Run Chr(34) & edgeAlt & Chr(34) & " --app=" & targetUrl, 1, False
  Else
    shell.Run targetUrl, 1, False
  End If
End Sub

Function FileExists(path)
  Set fso = CreateObject("Scripting.FileSystemObject")
  FileExists = fso.FileExists(path)
End Function
