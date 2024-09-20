import Foundation

@discardableResult
func shell(_ command: String) -> Int32 {
    let task = Process()
    task.launchPath = "/bin/bash"
    task.arguments = ["-c", command]
    task.launch()
    task.waitUntilExit()
    return task.terminationStatus
}

while let command = readLine() {
    if command == "exit" {
        break
    }
    let status = shell(command)
    print("Command executed with status: \(status)")
}