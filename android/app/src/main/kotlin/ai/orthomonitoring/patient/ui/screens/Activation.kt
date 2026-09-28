package ai.orthomonitoring.patient.ui.screens

import ai.orthomonitoring.patient.AppContainer
import ai.orthomonitoring.patient.data.ApiException
import ai.orthomonitoring.patient.ui.components.PrimaryButton
import ai.orthomonitoring.patient.ui.components.Wordmark
import ai.orthomonitoring.patient.ui.theme.Oma
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
fun ActivationScreen(c: AppContainer) {
    var clinic by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().background(Oma.Navy).verticalScroll(rememberScrollState()).systemBarsPadding().padding(28.dp)) {
        Wordmark()
        Spacer(Modifier.height(56.dp))
        Text("Your smile, checked in minutes.", style = MaterialTheme.typography.displaySmall.copy(color = Color.White))
        Spacer(Modifier.height(12.dp))
        Text("Enter the codes your clinic gave you. They connect this phone to your treatment securely.", color = Color.White.copy(alpha = 0.7f))
        Spacer(Modifier.height(36.dp))
        Column(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(24.dp)).padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            OutlinedTextField(clinic, { clinic = it.trim() }, label = { Text("Clinic code") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(code, { code = it.uppercase().take(12) }, label = { Text("Activation code") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters))
            error?.let { Text(it, color = Oma.Urgent) }
            PrimaryButton("Connect", enabled = clinic.isNotBlank() && code.length >= 6, loading = busy, color = Oma.Ember) {
                busy = true; error = null
                scope.launch {
                    try { val r = c.api.activate(clinic, code); c.session.signIn(r.token, r.firstName) }
                    catch (e: ApiException) { error = e.message } catch (e: Exception) { error = "Can't reach the clinic. Check your connection and try again." }
                    busy = false
                }
            }
        }
        Spacer(Modifier.height(24.dp))
        Text("Your photos are encrypted on this phone and in transit, and only your clinic team can see them. AI tools may help your orthodontist review photos; every decision is made by your orthodontist.",
            color = Color.White.copy(alpha = 0.55f), style = MaterialTheme.typography.bodyMedium)
    }
}
