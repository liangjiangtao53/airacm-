param(
  [string]$AndroidHome = "D:\AndroidLab\android-sdk",
  [string]$OutDir = "D:\AndroidLab\apk",
  [string]$ApiBase = "https://weixiuzhiyi.com.cn/api",
  [string]$DownloadBase = "https://weixiuzhiyi.com.cn",
  [string]$ApkName = "airacm-android.apk",
  [switch]$AllowScreenshots,
  [switch]$BuildBoth,
  [switch]$SkipPublicCopy
)

$ErrorActionPreference = "Stop"

$repo = Resolve-Path (Join-Path $PSScriptRoot "..")

if ($BuildBoth) {
  $commonArgs = @{
    AndroidHome = $AndroidHome
    OutDir = $OutDir
    ApiBase = $ApiBase
    DownloadBase = $DownloadBase
  }
  if ($SkipPublicCopy) {
    $commonArgs.SkipPublicCopy = $true
  }
  & $PSCommandPath @commonArgs -ApkName "airacm-android.apk"
  if ($LASTEXITCODE -ne 0) {
    throw "Secure APK build failed"
  }
  & $PSCommandPath @commonArgs -ApkName "airacm-android-screenshot.apk" -AllowScreenshots
  if ($LASTEXITCODE -ne 0) {
    throw "Screenshot APK build failed"
  }
  return
}

if ($AllowScreenshots -and $ApkName -eq "airacm-android.apk") {
  $ApkName = "airacm-android-screenshot.apk"
}

$uniDir = Join-Path $repo "apps\student-uni"
$shellDir = Join-Path $repo "apps\student-android-shell"
$workDir = Join-Path $repo ".tmp\student-apk"
$androidJar = Join-Path $AndroidHome "platforms\android-33\android.jar"
$buildToolVersion = "35.0.0"
$buildTools = Join-Path $AndroidHome "build-tools\$buildToolVersion"

function Invoke-Checked {
  param([scriptblock]$Command)
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE"
  }
}

if (!(Test-Path $androidJar)) {
  throw "Missing Android platform jar: $androidJar"
}
if (!(Test-Path $buildTools)) {
  throw "Missing Android build-tools. Install with: `"$AndroidHome\cmdline-tools\latest\bin\sdkmanager.bat`" `"build-tools;$buildToolVersion`""
}

Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $workDir, $OutDir | Out-Null

Push-Location $uniDir
try {
  $prevApiBase = $env:VITE_API_BASE
  $prevDownloadBase = $env:VITE_DOWNLOAD_BASE
  # 生产 APK 即使启动 query 丢失,也不能回退到本地 127.0.0.1。
  $env:VITE_API_BASE = $ApiBase
  $env:VITE_DOWNLOAD_BASE = $DownloadBase
  npm run build:h5 -- --base ./
} finally {
  $env:VITE_API_BASE = $prevApiBase
  $env:VITE_DOWNLOAD_BASE = $prevDownloadBase
  Pop-Location
}

$h5Dir = Join-Path $uniDir "dist\build\h5"
Get-ChildItem -Recurse -File $h5Dir -Include "*.js","*.html","*.css" | ForEach-Object {
  $content = Get-Content -Raw -Encoding UTF8 $_.FullName
  $next = $content.Replace("http://127.0.0.1:8770", $ApiBase).Replace("http://127.0.0.1:3000", $DownloadBase)
  # APK 内置 H5 通过 file:///android_asset/www/index.html 打开，绝对 /assets 或 /static 会解析到 file:///assets 导致白屏。
  $next = $next.Replace('href="/assets/', 'href="./assets/').Replace('src="/assets/', 'src="./assets/')
  $next = $next.Replace('"/static/', '"static/').Replace("'/static/", "'static/")
  $next = $next.Replace('url(/static/', 'url(../static/')
  if ($next -ne $content) {
    Set-Content -Encoding UTF8 -NoNewline -Path $_.FullName -Value $next
  }
}

$apkRoot = Join-Path $workDir "apk-root"
$assetsDir = Join-Path $apkRoot "assets"
$wwwDir = Join-Path $assetsDir "www"
New-Item -ItemType Directory -Force $wwwDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $uniDir "dist\build\h5\*") $wwwDir

$classesDir = Join-Path $workDir "classes"
$dexDir = Join-Path $workDir "dex"
$resDir = Join-Path $workDir "res"
$generatedSrcDir = Join-Path $workDir "src"
New-Item -ItemType Directory -Force $classesDir, $dexDir, $resDir, $generatedSrcDir | Out-Null

$sourceMain = Join-Path $shellDir "src\com\airacm\student\MainActivity.java"
$generatedMain = Join-Path $generatedSrcDir "com\airacm\student\MainActivity.java"
New-Item -ItemType Directory -Force (Split-Path $generatedMain) | Out-Null
$mainSource = Get-Content -Raw -Encoding UTF8 $sourceMain
if ($AllowScreenshots) {
  $mainSource = $mainSource -replace '(?s)\s*// SCREENSHOT_PROTECTION_START.*?// SCREENSHOT_PROTECTION_END', "`r`n    // Screenshot-enabled APK: FLAG_SECURE intentionally omitted."
}
[System.IO.File]::WriteAllText($generatedMain, $mainSource, [System.Text.UTF8Encoding]::new($false))

Invoke-Checked { javac --release 8 -encoding UTF-8 -cp $androidJar -d $classesDir $generatedMain }
$classFiles = Get-ChildItem -Recurse -File -Filter "*.class" $classesDir | ForEach-Object { $_.FullName }
Invoke-Checked { & (Join-Path $buildTools "d8.bat") --lib $androidJar --output $dexDir $classFiles }

$unsigned = Join-Path $workDir "airacm-android-unsigned.apk"
$aligned = Join-Path $workDir "airacm-android-aligned.apk"
$final = Join-Path $OutDir $ApkName
$compiledRes = Join-Path $resDir "compiled.zip"

Invoke-Checked { & (Join-Path $buildTools "aapt2.exe") compile --dir (Join-Path $shellDir "res") -o $compiledRes }
Invoke-Checked { & (Join-Path $buildTools "aapt2.exe") link -I $androidJar --manifest (Join-Path $shellDir "AndroidManifest.xml") -R $compiledRes --auto-add-overlay -o $unsigned }
Invoke-Checked { jar uf $unsigned -C $dexDir classes.dex }
Invoke-Checked { jar uf $unsigned -C $apkRoot assets }
Invoke-Checked { & (Join-Path $buildTools "zipalign.exe") -f 4 $unsigned $aligned }

$keystore = Join-Path $OutDir "airacm-debug.keystore"
if (!(Test-Path $keystore)) {
  Invoke-Checked { keytool -genkeypair -v -storepass android -keypass android -keystore $keystore -alias airacm-debug -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=airacm, OU=dev, O=airacm, L=local, S=local, C=CN" }
}

Invoke-Checked { & (Join-Path $buildTools "apksigner.bat") sign --ks $keystore --ks-key-alias airacm-debug --ks-pass pass:android --key-pass pass:android --out $final $aligned }
Invoke-Checked { & (Join-Path $buildTools "apksigner.bat") verify $final }

if (!$SkipPublicCopy) {
  Copy-Item -Force $final (Join-Path $repo "frontend\public\downloads\app\$ApkName")
}
Write-Output $final
