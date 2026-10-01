# Test-only UI navigation. The production gateway never invokes this script.
param([ValidateSet('refresh','refresh-details','reload','disconnect','return','activate','send','status','widget-state')][string]$Action = 'status', [int]$EdgeProcessId = 9792)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$root = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
  [System.Windows.Automation.TreeScope]::Children,
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $EdgeProcessId))
if (-not $root) { throw 'Existing test Edge window is unavailable.' }
function Find-Control([string]$Name, [bool]$BringIntoView = $false) {
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $matching = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Name))
    # Settings rows may have static labels with the same name as their button.
    # Prefer an actionable button rather than invoking its non-actionable label.
    $visible = @($matching | Where-Object { -not $_.Current.IsOffscreen })
    $actionable = @($visible | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -or $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem })
    # Do not invoke disabled controls while the host page is loading, or fall
    # back to a same-named static label when the actual button is disabled.
    $element = if ($actionable.Count -gt 0) {
      $actionable | Where-Object { $_.Current.IsEnabled } | Select-Object -First 1
    } else {
      $visible | Where-Object { $_.Current.IsEnabled } | Select-Object -First 1
    }
    if ($element) { return $element }
    if ($BringIntoView) {
      $focusable = $matching | Where-Object { $_.Current.IsKeyboardFocusable } | Select-Object -First 1
      if ($focusable) { $focusable.SetFocus() }
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Missing test UI control: $Name"
}
function Invoke-Control([string]$Name, [bool]$BringIntoView = $false) {
  $element = Find-Control $Name $BringIntoView
  $pattern = $null
  for ($i = 0; $i -lt 4; $i++) {
    if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
      $pattern.Invoke()
      return
    }
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
      $pattern.Expand()
      return
    }
    $element = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($element)
  }
  throw "Test UI control is not invokable: $Name"
}
switch ($Action) {
  'disconnect' {
    $bar = Find-Control 'Address and search bar'
    $currentAddress = $bar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
    $parsedAddress = $null
    if (-not [uri]::TryCreate($currentAddress, [UriKind]::Absolute, [ref]$parsedAddress) -or $parsedAddress.Scheme -ne 'https' -or $parsedAddress.Host -ne 'chatgpt.com') {
      throw 'Disconnect test requires the existing ChatGPT test tab.'
    }
    $bar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('about:blank')
    $bar.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    'Test tab navigated away; verify heartbeat expiry separately.'
  }
  'return' {
    $bar = Find-Control 'Address and search bar'
    if ($bar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value -ne 'about:blank') {
      throw 'Return test requires the temporary blank test tab.'
    }
    $bar.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait('%{LEFT}')
    'Test tab returned to previous page; verify fresh heartbeat separately.'
  }
  'reload' {
    (Find-Control 'Address and search bar').SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait('^r')
    'Existing test page reload requested; verify widget version separately.'
  }
  'widget-state' {
    # Exact static labels only; never account/sidebar/URL/exception/chat content.
    $labels = @('CoworkerAPI bridge · v5','CoworkerAPI bridge · v6','Connecting…','Previous request finished. Waiting briefly.','Ready. Waiting for an API request.','Waiting for ChatGPT to return the current API request…','Request sent. Waiting for the MCP result callback.','Delivery not confirmed. Waiting for callback; no automatic resend.','ChatGPT rejected the follow-up. Waiting before retry.','Bridge temporarily unavailable. Retrying the status check.','This ChatGPT surface does not expose the required MCP App APIs.','Open the bridge again to upgrade this widget.')
    $labels += 'CoworkerAPI bridge · v7'
    $labels += 'CoworkerAPI bridge · v8'
    $labels += 'Previous ChatGPT send is still pending. No overlapping dispatch.'
    $statuses = @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) |
      Where-Object { $labels -contains $_.Current.Name } |
      ForEach-Object { [PSCustomObject]@{status=$_.Current.Name;offscreen=$_.Current.IsOffscreen} })
    [PSCustomObject]@{elements=$statuses.Count;statuses=$statuses} | ConvertTo-Json -Depth 4
  }
  'refresh' {
    (Find-Control 'Open profile menu').GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
    Invoke-Control 'Settings'
    $null = Find-Control 'Data controls'
    Invoke-Control 'Plugins'
    Invoke-Control 'coworker coworker Allow all tools'
    Invoke-Control 'Actions for coworker (no account linked)'
    Invoke-Control 'Refresh tools' $true
    # The account action opens Manage app; refresh is a separate button there.
    Invoke-Control 'Refresh tools' $true
    'Refresh tools invoked; verify server diagnostics separately.'
  }
  'refresh-details' {
    Invoke-Control 'Refresh tools' $true
    'Manage-app refresh invoked; verify tools/list and resource reads separately.'
  }
  'activate' {
    $bar = Find-Control 'Address and search bar'
    $prompt = 'Use the CoworkerAPI plugin tool workbench_api_activate now to open the CoworkerAPI bridge widget in this new chat.'
    $bar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('https://chatgpt.com/?q=' + [uri]::EscapeDataString($prompt))
    $bar.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    'Activation URL opened; Send remains an explicit test action.'
  }
  'send' { Invoke-Control 'Send'; 'Activation prompt sent.' }
  'status' {
    # Exclude account/sidebar text, address values, and credential fields.
    $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button)) |
      Where-Object { $_.Current.Name -match '^(Refresh tools|Refresh|Reconnect|Close|Back|Send|Stop|Allow|Confirm|Update|Done|Save|Apply|coworker)(\b|$)' } |
      ForEach-Object { [PSCustomObject]@{name=$_.Current.Name;offscreen=$_.Current.IsOffscreen;enabled=$_.Current.IsEnabled} } |
      ConvertTo-Json -Depth 3
  }
}
