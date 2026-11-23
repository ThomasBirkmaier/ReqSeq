# The recorders of the shell's e2e suite on Windows (ADR-0021, Test seam; SR-252 AK2, AK6, AK7), called by
# e2e/record-windows.ts. Needs an elevated Windows PowerShell 5.1 or later. Each action writes its result as UTF-8
# to -Out (JSON, or tab-separated lines for the file events) and prints nothing else on success.
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$Out,
  [string]$Session,
  [string]$Etl,
  [string]$Since,
  [string]$In,
  [string]$Group,
  [string]$Programs,
  [string]$Pids
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false

function Write-Out([string]$text) {
  [System.IO.File]::WriteAllText($Out, $text, $utf8)
}

function Native-Calls {
  if (-not ('ReqSeqE2e.Native' -as [type])) {
    Add-Type -Namespace ReqSeqE2e -Name Native -MemberDefinition @'
[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern uint QueryDosDevice(string device, System.Text.StringBuilder target, uint size);
[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern uint GetLongPathName(string path, System.Text.StringBuilder longPath, uint size);
'@
  }
}

# The inclusion setting of an audit subcategory ("Success", "Failure", "Success and Failure", "No Auditing").
function Audit-Setting([string]$guid) {
  $rows = @(auditpol /get /subcategory:"$guid" /r | Where-Object { $_ -ne '' } | ConvertFrom-Csv)
  if ($rows.Count -eq 0) { return '' }
  return [string]$rows[0].'Inclusion Setting'
}

# Event fields by name, plus the event's time, its record number in its log and the process ID it ran in.
function Event-Row($event) {
  $x = [xml]$event.ToXml()
  $row = [ordered]@{ _time = $event.TimeCreated.ToUniversalTime().ToString('o'); _record = [string]$event.RecordId; _pid = [string]$x.Event.System.Execution.ProcessID }
  foreach ($d in $x.Event.EventData.Data) { $row[$d.Name] = [string]$d.'#text' }
  return $row
}

# Whether an error of Get-WinEvent only says that no event matched; every other read error ends the action.
function No-Events($err) {
  return $err.FullyQualifiedErrorId -like 'NoMatchingEventsFound*'
}

function Export-Log([string]$log, [int]$id, [datetime]$start) {
  try {
    $rows = @(Get-WinEvent -FilterHashtable @{ LogName = $log; Id = $id; StartTime = $start } -ErrorAction Stop |
        ForEach-Object { Event-Row $_ })
  } catch {
    if (-not (No-Events $_)) { throw }
    $rows = @()
  }
  return , $rows
}

switch ($Action) {
  # What the recording needs and whether it is there: elevation, the audit of process creation with command
  # lines and of refused connections, the DNS client log and the firewall profiles.
  'check' {
    $identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    $cmdLine = Get-ItemProperty -Path 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Policies\System\Audit' -Name ProcessCreationIncludeCmdLine_Enabled -ErrorAction SilentlyContinue
    $dns = Get-WinEvent -ListLog 'Microsoft-Windows-DNS-Client/Operational' -ErrorAction SilentlyContinue
    $result = [ordered]@{
      elevated          = $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
      processCreation   = Audit-Setting '{0CCE922B-69AE-11D9-BED3-505054503030}'
      commandLine       = ($null -ne $cmdLine -and $cmdLine.ProcessCreationIncludeCmdLine_Enabled -eq 1)
      refusedConnection = Audit-Setting '{0CCE9226-69AE-11D9-BED3-505054503030}'
      dnsLog            = ($null -ne $dns -and $dns.IsEnabled)
      profiles          = @(Get-NetFirewallProfile | ForEach-Object { [ordered]@{ name = [string]$_.Name; enabled = [string]$_.Enabled } })
      engines           = @(Get-ChildItem 'C:\Program Files (x86)\Microsoft\EdgeWebView\Application\*\msedgewebview2.exe', 'C:\Program Files\Microsoft\EdgeWebView\Application\*\msedgewebview2.exe' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
    }
    Write-Out (ConvertTo-Json -InputObject $result -Depth 4)
  }
  # Firewall rules that refuse every outbound connection of the programs that does not go to a loopback address.
  'rules-add' {
    Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    $remote = @('1.0.0.0-126.255.255.255', '128.0.0.0-255.255.255.255', '::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
    foreach ($p in @($Programs -split '\|' | Where-Object { $_ -ne '' })) {
      New-NetFirewallRule -DisplayName "$Group $p" -Group $Group -Direction Outbound -Action Block -Program $p -RemoteAddress $remote | Out-Null
    }
    $rules = @(Get-NetFirewallRule -Group $Group | ForEach-Object { [string]($_ | Get-NetFirewallApplicationFilter).Program })
    Write-Out (ConvertTo-Json -InputObject $rules)
  }
  'rules-remove' {
    Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  }
  # The Kernel-File provider with the keywords FILENAME, CREATE, WRITE and CREATE_NEW_FILE, level 5.
  'trace-start' {
    logman stop $Session -ets 2>&1 | Out-Null
    $text = logman start $Session -p Microsoft-Windows-Kernel-File 0x1290 0x5 -o $Etl -ets -bs 1024 -nb 128 640 2>&1
    if ($LASTEXITCODE -ne 0) { throw "logman start failed: $text" }
  }
  # Stops the trace and says how many buffers and events it lost.
  'trace-stop' {
    $query = (logman query $Session -ets 2>&1) -join "`n"
    $text = logman stop $Session -ets 2>&1
    if ($LASTEXITCODE -ne 0) { throw "logman stop failed: $text" }
    $csv = "$Etl.csv"
    $summary = "$Etl.summary.txt"
    $text = tracerpt $Etl -o $csv -of CSV -summary $summary -y 2>&1
    if ($LASTEXITCODE -ne 0) { throw "tracerpt failed: $text" }
    Remove-Item -Force $csv -ErrorAction SilentlyContinue
    $sum = Get-Content -Raw $summary
    $buffers = if ($query -match 'Buffers Lost:\s+(\d+)') { [int]$Matches[1] } else { -1 }
    $events = if ($sum -match 'Events\s+Lost\s+(\d+)') { [int]$Matches[1] } else { -1 }
    $processed = if ($sum -match 'Events\s+Processed\s+(\d+)') { [int]$Matches[1] } else { -1 }
    Write-Out (ConvertTo-Json -InputObject ([ordered]@{ buffersLost = $buffers; eventsLost = $events; eventsProcessed = $processed }))
  }
  # Process creation (4688), refused connections (5157) and name lookups (3006) since -Since.
  'events' {
    $start = [datetime]::Parse($Since, $null, [System.Globalization.DateTimeStyles]::RoundtripKind).ToLocalTime()
    $result = [ordered]@{
      processes   = Export-Log 'Security' 4688 $start
      refused     = Export-Log 'Security' 5157 $start
      lookups     = Export-Log 'Microsoft-Windows-DNS-Client/Operational' 3006 $start
    }
    Write-Out (ConvertTo-Json -InputObject $result -Depth 4)
  }
  # The Kernel-File events of the given processes, and every NameCreate (10), which names a file key for the
  # writes: one line per event, `id pid FileObject FileKey CreateOptions FileName`, tab-separated.
  'files' {
    $ids = @($Pids -split ',' | Where-Object { $_ -ne '' })
    $xpath = '*[System[EventID=10' + (($ids | ForEach-Object { " or Execution[@ProcessID=$_]" }) -join '') + ']]'
    $writer = New-Object System.IO.StreamWriter($Out, $false, $utf8)
    try {
      Get-WinEvent -Path $Etl -Oldest -FilterXPath $xpath -ErrorAction Stop | ForEach-Object {
        $x = [xml]$_.ToXml()
        $f = @{}
        foreach ($d in $x.Event.EventData.Data) { $f[$d.Name] = [string]$d.'#text' }
        $writer.WriteLine(("{0}`t{1}`t{2}`t{3}`t{4}`t{5}" -f $_.Id, $x.Event.System.Execution.ProcessID, $f['FileObject'], $f['FileKey'], $f['CreateOptions'], $f['FileName']))
      }
    } catch {
      if (-not (No-Events $_)) { throw }
    } finally {
      $writer.Close()
    }
  }
  # The device of each drive letter, as the trace names it (`\Device\HarddiskVolume3`).
  'devices' {
    Native-Calls
    $map = [ordered]@{}
    foreach ($letter in [char[]]([char]'A'..[char]'Z')) {
      $sb = New-Object System.Text.StringBuilder 1024
      if ([ReqSeqE2e.Native]::QueryDosDevice("${letter}:", $sb, 1024) -ne 0) { $map["${letter}:"] = $sb.ToString() }
    }
    Write-Out (ConvertTo-Json -InputObject $map)
  }
  # The long form of each path of -In (one per line): 8.3 names expanded as far as the path still exists.
  'long' {
    Native-Calls
    $lines = [System.IO.File]::ReadAllLines($In, $utf8)
    $result = foreach ($p in $lines) {
      $head = $p
      $tail = ''
      $long = $null
      while ($head.Length -gt 3) {
        $sb = New-Object System.Text.StringBuilder 4096
        if ([ReqSeqE2e.Native]::GetLongPathName($head, $sb, 4096) -ne 0) { $long = $sb.ToString() + $tail; break }
        $cut = $head.LastIndexOf('\')
        if ($cut -lt 2) { break }
        $tail = $head.Substring($cut) + $tail
        $head = $head.Substring(0, $cut)
      }
      if ($null -eq $long) { $p } else { $long }
    }
    [System.IO.File]::WriteAllLines($Out, [string[]]@($result), $utf8)
  }
  default { throw "unknown action $Action" }
}
