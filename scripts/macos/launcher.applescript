on launchEcho()
  try
    set projectDirectory to read (path to resource "project-path.txt") as «class utf8»
    do shell script "/bin/bash " & quoted form of (projectDirectory & "/scripts/echo.sh") & " start --open"
  on error errorMessage
    display alert "无法启动 Echo" message errorMessage as critical buttons {"好"} default button "好"
  end try
end launchEcho

on run
  launchEcho()
end run

on reopen
  launchEcho()
end reopen
