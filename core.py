from __future__ import annotations
import re
from dataclasses import dataclass, field
from typing import Dict, List, Tuple
from collections import defaultdict

@dataclass
class INPParseResult:
    sections: Dict[str, Dict[str, List[str]]] = field(default_factory=lambda: defaultdict(dict))
    headers: Dict[str, List[str]] = field(default_factory=dict)
    tags: Dict[str, str] = field(default_factory=dict)
    descriptions: Dict[str, str] = field(default_factory=dict)

def parse_inp(path: str) -> INPParseResult:
    sections = defaultdict(dict); headers = {}; tags = {}; descriptions = {}
    current = None; after_header = False
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        for raw in f:
            line = raw.rstrip('\n')
            m = re.match(r'^\s*\[([^\]]+)\]\s*$', line)
            if m:
                current = m.group(1).upper()
                headers.setdefault(current, []); descriptions.setdefault(current, '')
                after_header = True; continue
            if current is None: continue
            if after_header:
                if line.lstrip().startswith(';') and not line.lstrip().startswith(';;'):
                    descriptions[current] = line.lstrip('; ').strip()
                    after_header = False; continue
                elif line.strip() != '':
                    after_header = False
            if not line.strip(): continue
            if line.lstrip().startswith(';') and not line.lstrip().startswith(';;'): continue
            if line.strip().startswith(';;'):
                content = line.strip()[2:].strip()
                if content and not all(c in '- ' for c in content):
                    if not headers[current]:
                        headers[current] = re.split(r'\s{2,}', content)
                continue
            tokens = re.split(r'\s+', line.strip())
            if not tokens: continue
            if current == 'TAGS':
                if len(tokens) >= 3:
                    element_id = tokens[1]; tag_name = ' '.join(tokens[2:])
                    tags[element_id] = tag_name
                continue
            element_id = tokens[0]; values = tokens[1:]
            sections[current][element_id] = values
    return INPParseResult(sections, headers, tags, descriptions)

@dataclass
class DiffSection:
    added: List[str] = field(default_factory=list)
    removed: List[str] = field(default_factory=list)
    changed: Dict[str, Tuple[List[str], List[str]]] = field(default_factory=dict)

def compare_sections(secs1, secs2, headers1, headers2):
    out = {}; all_headers = {}
    for sec in sorted(set(secs1) | set(secs2)):
        recs1 = secs1.get(sec, {}); recs2 = secs2.get(sec, {})
        k1, k2 = set(recs1), set(recs2)
        added = sorted(k2 - k1); removed = sorted(k1 - k2)
        changed = {k: (recs1[k], recs2[k]) for k in (k1 & k2) if recs1.get(k) != recs2.get(k)}
        if added or removed or changed:
            out[sec] = DiffSection(added, removed, changed)
            all_headers[sec] = headers1.get(sec) or headers2.get(sec, [])
    return out, all_headers
