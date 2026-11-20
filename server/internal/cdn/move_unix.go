package cdn

import "syscall"

// A rename between disks fails with EXDEV
var errCrossDevice error = syscall.EXDEV
