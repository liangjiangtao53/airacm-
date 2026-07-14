Android APK files:

- `airacm-android.apk`: production package. Screenshots and screen recording are blocked.
- `D:\AndroidLab\apk\airacm-android-screenshot.apk`: local QA package. Screenshots are allowed and the file must not be published.

Build the production package, then build the local QA package without copying it into the public directory:

```powershell
.\scripts\package-student-apk.ps1
.\scripts\package-student-apk.ps1 -ApkName airacm-android-screenshot.apk -AllowScreenshots -SkipPublicCopy
```

Student download keeps using `/downloads/app/airacm-android.apk` by default.
