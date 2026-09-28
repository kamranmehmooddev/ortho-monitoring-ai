package ai.orthomonitoring.patient

import ai.orthomonitoring.patient.ui.nav.AppRoot
import ai.orthomonitoring.patient.ui.theme.OmaTheme
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Intraoral photos and clinic messages must not appear in screenshots or the recent-apps preview.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        val container = (application as OmaApp).container
        setContent { OmaTheme { AppRoot(container) } }
    }
}
