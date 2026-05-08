#!/usr/bin/env python3
# ABOUTME: Backwards-compatibility shim — forwards to build_configurator.py.
# ABOUTME: Use build_configurator.py for new work.

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_configurator import main

if __name__ == "__main__":
    sys.exit(main())
