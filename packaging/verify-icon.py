"""Check that Windows executables embed every supplied ICO image unchanged."""
import hashlib
import json
from pathlib import Path
import struct
import sys

import pefile

source = Path(__file__).with_name("icon.ico").read_bytes()
reserved, kind, count = struct.unpack_from("<HHH", source)
assert (reserved, kind, count) == (0, 1, 7)
expected = set()
for index in range(count):
    entry = struct.unpack_from("<BBBBHHII", source, 6 + index * 16)
    size, offset = entry[-2:]
    expected.add(hashlib.sha256(source[offset:offset + size]).digest())

for filename in sys.argv[1:]:
    with pefile.PE(filename) as executable:
        actual = set()
        for resource in executable.DIRECTORY_ENTRY_RESOURCE.entries:
            if resource.id != 3:  # RT_ICON
                continue
            for icon in resource.directory.entries:
                for language in icon.directory.entries:
                    data = language.data.struct
                    actual.add(hashlib.sha256(executable.get_data(data.OffsetToData, data.Size)).digest())
        assert expected.issubset(actual), f"Icon resources differ in {filename}"
        print(json.dumps({"success": True, "file": str(Path(filename)), "matching_frames": count}))
