# Test-only visual diagnosis of the existing logged-in test browser.
param([int]$EdgeProcessId=9792)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CoworkerApiTestCapture {
  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
}
'@
$window=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
  [System.Windows.Automation.TreeScope]::Children,
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$EdgeProcessId))
if(-not $window){throw 'Existing test browser window unavailable.'}
$rect=$window.Current.BoundingRectangle
if($rect.Width -le 0 -or $rect.Height -le 0 -or $rect.Width -gt 10000 -or $rect.Height -gt 10000){throw 'Invalid test window bounds.'}
$bitmap=[System.Drawing.Bitmap]::new([int]$rect.Width,[int]$rect.Height)
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
try {
  $device=$graphics.GetHdc()
  try {
    if(-not [CoworkerApiTestCapture]::PrintWindow([IntPtr]$window.Current.NativeWindowHandle,$device,2)){throw 'Test window capture unavailable.'}
  } finally {$graphics.ReleaseHdc($device)}
  $target=Join-Path $env:TEMP ('coworkerapi-test-view-'+[guid]::NewGuid().ToString('N')+'.png')
  $bitmap.Save($target,[System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output $target
} finally {$graphics.Dispose();$bitmap.Dispose()}
