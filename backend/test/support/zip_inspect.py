# Lector independiente del paquete de portabilidad para las pruebas (ADR 0024): zipfile de Python.
# Uso: python3 -I zip_inspect.py <zip> [nombre ...]. Imprime un JSON con el número de entradas, el
# resultado de testzip (CRC de cada entrada), los atributos y, de cada nombre pedido, su tamaño, su
# método y el SHA-256 de sus bytes. No se llama inspect.py: sombrearía el módulo de la biblioteca.
import hashlib
import json
import sys
import zipfile

if sys.argv[1] == "--extract":
    # python3 -I zip_inspect.py --extract <zip> <destino>: extrae todo y lista las entradas en orden.
    with zipfile.ZipFile(sys.argv[2]) as archive:
        archive.extractall(sys.argv[3])
        print(json.dumps([info.filename for info in archive.infolist()]))
    sys.exit(0)

path, wanted = sys.argv[1], sys.argv[2:]
with zipfile.ZipFile(path) as archive:
    infos = archive.infolist()
    kinds = [(info.external_attr >> 16) & 0o170000 for info in infos]
    result = {
        "count": len(infos),
        "bad": archive.testzip(),
        "regular": all(kind == 0o100000 for kind in kinds),
        "symlinks": sum(1 for kind in kinds if kind == 0o120000),
        "utf8": all(info.flag_bits & 0x800 for info in infos),
        "dataDescriptor": any(info.flag_bits & 0x8 for info in infos),
        "names": [info.filename for info in infos[:20]],
        "entries": {},
    }
    for name in wanted:
        info = archive.getinfo(name)
        result["entries"][name] = {
            "size": info.file_size,
            "method": "deflate" if info.compress_type == zipfile.ZIP_DEFLATED else "store",
            "sha256": hashlib.sha256(archive.read(name)).hexdigest(),
            "headerOffset": info.header_offset,
        }
print(json.dumps(result))
