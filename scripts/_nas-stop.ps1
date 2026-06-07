param(
  [string]$User = $env:NAS_DEPLOY_USER,
  [string]$Pass = $env:NAS_DEPLOY_PASS
)
if (-not $User -or -not $Pass) { throw "Set NAS_DEPLOY_USER and NAS_DEPLOY_PASS" }
Import-Module Posh-SSH
$sec = ConvertTo-SecureString $Pass -AsPlainText -Force
$cred = New-Object PSCredential($User, $sec)
$ssh = New-SSHSession -ComputerName 192.168.1.59 -Credential $cred -AcceptKey -Force
$ep = $Pass.Replace("'", "'\''")
$cmd = "echo '$ep' | sudo -S sh -c 'cd /volume1/docker/mr2525-template-catalog && /usr/local/bin/docker compose stop template-catalog'"
$r = Invoke-SSHCommand -SessionId $ssh.SessionId -Command $cmd -TimeOut 60
$r.Output
Remove-SSHSession $ssh.SessionId | Out-Null
