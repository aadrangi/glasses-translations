import SwiftUI
import MentraBluetoothSDK

/// Bring-up skeleton: proves the G1-only SDK compiles, links, and loads in an
/// app. Next milestones: scan/connect (DeviceManager) → text wall "HELLO" →
/// mic → sherpa-onnx STT → TranslationSession.
struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Glasses Translations")
                .font(.title2.bold())
            Text("MentraBluetoothSDK linked — BLE bring-up pending")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
