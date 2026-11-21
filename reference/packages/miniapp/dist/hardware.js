/** Hardware components that a miniapp can declare in its manifest. */
export var HardwareType;
(function (HardwareType) {
    HardwareType["CAMERA"] = "CAMERA";
    HardwareType["DISPLAY"] = "DISPLAY";
    HardwareType["MICROPHONE"] = "MICROPHONE";
    HardwareType["SPEAKER"] = "SPEAKER";
    HardwareType["IMU"] = "IMU";
    HardwareType["BUTTON"] = "BUTTON";
    HardwareType["LIGHT"] = "LIGHT";
    HardwareType["WIFI"] = "WIFI";
    HardwareType["EXIST"] = "EXIST";
})(HardwareType || (HardwareType = {}));
/** Whether a missing component prevents the miniapp from running. */
export var HardwareRequirementLevel;
(function (HardwareRequirementLevel) {
    HardwareRequirementLevel["REQUIRED"] = "REQUIRED";
    HardwareRequirementLevel["OPTIONAL"] = "OPTIONAL";
})(HardwareRequirementLevel || (HardwareRequirementLevel = {}));
//# sourceMappingURL=hardware.js.map