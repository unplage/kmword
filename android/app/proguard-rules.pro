# Keep WebView classes
-keepclassmembers class * extends android.webkit.WebView {
    <init>(android.content.Context);
    <init>(android.content.Context, android.util.AttributeSet);
    <init>(android.content.Context, android.util.AttributeSet, int);
}
