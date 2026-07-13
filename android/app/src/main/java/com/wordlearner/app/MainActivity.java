package com.wordlearner.app;

import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.util.HashMap;
import java.util.Locale;
import java.util.Set;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private ValueCallback<Uri[]> uploadMessage;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private boolean isPaused = false;
    private String lastSpokenText = null;
    private float lastSpokenRate = 1.0f;
    private String lastSpokenVoice = null;
    private String pendingSpeakText = null;
    private float pendingSpeakRate = 1.0f;
    private String pendingSpeakVoice = null;
    private static final int FILE_CHOOSER_REQUEST_CODE = 100;
    private static final String TTS_UTTERANCE_ID = "kmword_utterance";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("file://") || url.startsWith("data:")) {
                    return false;
                }
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                } catch (Exception e) {
                    return false;
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (uploadMessage != null) {
                    uploadMessage.onReceiveValue(null);
                    uploadMessage = null;
                }
                uploadMessage = filePathCallback;

                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE);
                } catch (Exception e) {
                    uploadMessage = null;
                    return false;
                }
                return true;
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                try {
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    String fileName = android.webkit.URLUtil.guessFileName(url, contentDisposition, mimetype);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    dm.enqueue(request);
                    Toast.makeText(MainActivity.this, "正在下载: " + fileName, Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                }
            }
        });

        // 初始化原生 TTS
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                ttsReady = true;
                tts.setLanguage(Locale.US);
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String utteranceId) {}
                    @Override public void onDone(String utteranceId) {
                        webView.post(() -> webView.evaluateJavascript(
                            "if(window.app && window.app._onAndroidTTSDone) window.app._onAndroidTTSDone()",
                            null
                        ));
                    }
                    @Override public void onError(String utteranceId) {}
                });
                // 通知 JS TTS 已就绪
                webView.post(() -> webView.evaluateJavascript(
                    "if(window.app) { window.app._onTTSReady(); }", null
                ));
                // 处理初始化前积压的朗读请求
                if (pendingSpeakText != null) {
                    doSpeak(pendingSpeakText, pendingSpeakRate, pendingSpeakVoice);
                    pendingSpeakText = null;
                }
            } else {
                // TTS 初始化失败，通知 JS 尝试浏览器备选
                webView.post(() -> webView.evaluateJavascript(
                    "if(window.app) { window.app._onTTSFailed(); }", null
                ));
            }
        });

        webView.addJavascriptInterface(new WebAppInterface(this), "Android");
        webView.addJavascriptInterface(new TTSInterface(), "AndroidTTS");

        webView.loadUrl("file:///android_asset/index.html");
    }

    public class WebAppInterface {
        private Context context;

        WebAppInterface(Context context) {
            this.context = context;
        }

        @JavascriptInterface
        public void saveFile(String filename, String content) {
            try {
                byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                    values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/WordLearner");
                    Uri uri = context.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        OutputStream os = context.getContentResolver().openOutputStream(uri);
                        if (os != null) {
                            os.write(bytes);
                            os.close();
                        }
                    } else {
                        throw new Exception("Failed to create MediaStore entry");
                    }
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(
                            Environment.DIRECTORY_DOWNLOADS), "WordLearner");
                    if (!dir.exists()) dir.mkdirs();
                    File file = new File(dir, filename);
                    FileOutputStream fos = new FileOutputStream(file);
                    fos.write(bytes);
                    fos.close();
                }
                runOnUiThread(() ->
                    Toast.makeText(context,
                            "已导出到 Downloads/WordLearner/" + filename,
                            Toast.LENGTH_LONG).show()
                );
            } catch (Exception e) {
                // 尝试 fallback 到应用私有目录
                try {
                    File fallbackDir = new File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "WordLearner");
                    if (!fallbackDir.exists()) fallbackDir.mkdirs();
                    File fallbackFile = new File(fallbackDir, filename);
                    FileOutputStream fos = new FileOutputStream(fallbackFile);
                    fos.write(content.getBytes(StandardCharsets.UTF_8));
                    fos.close();
                    String msg = "已导出到 " + fallbackFile.getAbsolutePath();
                    runOnUiThread(() -> Toast.makeText(context, msg, Toast.LENGTH_LONG).show());
                } catch (Exception e2) {
                    runOnUiThread(() ->
                        Toast.makeText(context, "导出失败: " + e.getMessage(), Toast.LENGTH_LONG).show()
                    );
                }
            }
        }
    }

    private void doSpeak(String text, float rate, String voiceName) {
        if (!ttsReady || text == null) return;
        tts.stop();
        // 设置语速 (1.0 = normal)
        tts.setSpeechRate(Math.max(0.1f, Math.min(2.0f, rate)));
        // 设置音色
        if (voiceName != null && !voiceName.isEmpty()) {
            try {
                Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                    for (Voice v : voices) {
                        if (voiceName.equals(v.getName())) {
                            tts.setVoice(v);
                            break;
                        }
                    }
                }
            } catch (Exception ignored) {}
        }
        HashMap<String, String> params = new HashMap<>();
        params.put(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, TTS_UTTERANCE_ID);
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, params);
        lastSpokenText = text;
        lastSpokenRate = rate;
        lastSpokenVoice = voiceName;
    }

    public class TTSInterface {
        @JavascriptInterface
        public void speak(String text, double rate, String voiceName) {
            if (!ttsReady) {
                pendingSpeakText = text;
                pendingSpeakRate = (float) rate;
                pendingSpeakVoice = voiceName;
                return;
            }
            doSpeak(text, (float) rate, voiceName);
        }

        @JavascriptInterface
        public void stop() {
            if (ttsReady) {
                tts.stop();
                isPaused = false;
            }
        }

        @JavascriptInterface
        public void pause() {
            if (ttsReady && tts.isSpeaking()) {
                tts.stop();
                isPaused = true;
            }
        }

        @JavascriptInterface
        public void resume() {
            if (ttsReady && isPaused && lastSpokenText != null) {
                doSpeak(lastSpokenText, lastSpokenRate, lastSpokenVoice);
                isPaused = false;
            }
        }

        @JavascriptInterface
        public String getVoices() {
            if (!ttsReady) return "[]";
            try {
                Set<Voice> voiceSet = tts.getVoices();
                if (voiceSet == null) return "[]";
                StringBuilder sb = new StringBuilder("[");
                boolean first = true;
                for (Voice v : voiceSet) {
                    if (!first) sb.append(",");
                    first = false;
                    sb.append("{\"name\":\"");
                    sb.append(escapeJson(v.getName()));
                    sb.append("\",\"lang\":\"");
                    Locale l = v.getLocale();
                    String lang = l.getLanguage();
                    if (!l.getCountry().isEmpty()) lang += "-" + l.getCountry().toLowerCase();
                    sb.append(escapeJson(lang));
                    sb.append("\"}");
                }
                sb.append("]");
                return sb.toString();
            } catch (Exception e) {
                return "[]";
            }
        }

        private String escapeJson(String s) {
            if (s == null) return "";
            return s.replace("\\", "\\\\")
                    .replace("\"", "\\\"")
                    .replace("\n", "\\n")
                    .replace("\r", "\\r")
                    .replace("\t", "\\t");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (uploadMessage != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK) {
                    if (data != null) {
                        String dataString = data.getDataString();
                        if (dataString != null) {
                            results = new Uri[]{Uri.parse(dataString)};
                        }
                    }
                }
                uploadMessage.onReceiveValue(results);
                uploadMessage = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (ttsReady && tts != null) {
            tts.stop();
            tts.shutdown();
        }
        super.onDestroy();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
    }
}
