Android APK files:

- `airacm-android.apk`: production package. Screenshots and screen recording are blocked.
- `airacm-android-screenshot.apk`: test package. Screenshots are allowed for QA and support.

Build both packages:

```powershell
.\scripts\package-student-apk.ps1 -BuildBoth
```

Student download keeps using `/downloads/app/airacm-android.apk` by default.
