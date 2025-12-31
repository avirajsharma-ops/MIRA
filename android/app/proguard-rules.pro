# Add project specific ProGuard rules here.
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-keepattributes Signature
-keepattributes Exceptions

# Keep WebView JavaScript interface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep service classes
-keep class cloud.itsmira.app.** { *; }

# Keep WebView classes
-keep class android.webkit.** { *; }
-keepclassmembers class android.webkit.** { *; }

# Keep AndroidX classes
-keep class androidx.** { *; }
-keep interface androidx.** { *; }

# Keep Material Design
-keep class com.google.android.material.** { *; }

# Prevent R8 from stripping interface information
-keepclassmembers,allowobfuscation class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# Remove logging in release
-assumenosideeffects class android.util.Log {
    public static int d(...);
    public static int v(...);
}
