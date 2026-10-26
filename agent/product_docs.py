import math
import re
from dataclasses import dataclass
from pathlib import Path

PRODUCT_DOCS_DIR = Path(__file__).resolve().parent.parent / "docs" / "product"
WORD_PATTERN = re.compile(r"[a-z0-9]+", re.IGNORECASE)
STOP_WORDS = {
    "a", "about", "an", "and", "are", "as", "at", "be", "can", "do", "does",
    "for", "from", "how", "i", "in", "is", "it", "me", "my", "of", "on",
    "or", "please", "tell", "that", "the", "their", "this", "to", "what",
    "mean", "means", "meaning", "when", "where", "which", "who", "why",
    "with", "you", "your",
}
WORD_NORMALIZATIONS = {
    "owned": "own",
    "owner": "own",
    "owners": "own",
    "owns": "own",
}


@dataclass(frozen=True)
class Passage:
    source: str
    title: str
    text: str
    terms: frozenset[str]


def _tokens(text: str) -> list[str]:
    return [
        WORD_NORMALIZATIONS.get(word.lower(), word.lower())
        for word in WORD_PATTERN.findall(text)
        if len(word) > 1
    ]


def _parse_document(path: Path) -> list[Passage]:
    contents = path.read_text(encoding="utf-8")
    sections = contents.split("---", 2)
    if len(sections) != 3 or sections[0].strip():
        raise ValueError(f"{path} must start with a YAML frontmatter block.")

    title = None
    for line in sections[1].splitlines():
        key, separator, value = line.partition(":")
        if separator and key.strip() == "title":
            title = value.strip()
    if not title:
        raise ValueError(f"{path} is missing its product document title.")
    passages: list[Passage] = []
    for paragraph in re.split(r"\n\s*\n", sections[2].strip()):
        text = paragraph.strip()
        if not text:
            continue
        terms = frozenset(_tokens(f"{title} {text}")) - STOP_WORDS
        passages.append(Passage(path.name, title, text, terms))
    return passages


def load_product_passages(directory: Path = PRODUCT_DOCS_DIR) -> list[Passage]:
    if not directory.is_dir():
        raise FileNotFoundError(f"Product documentation directory not found: {directory}")
    paths = sorted(directory.glob("*.md"))
    if not paths:
        raise FileNotFoundError(f"No product documentation found in {directory}")
    passages = [passage for path in paths for passage in _parse_document(path)]
    if not passages:
        raise ValueError(f"No searchable passages found in {directory}")
    return passages


def search_product_docs(
    query: str,
    *,
    directory: Path = PRODUCT_DOCS_DIR,
    limit: int = 3,
) -> list[Passage]:
    query_terms = set(_tokens(query)) - STOP_WORDS
    if not query_terms:
        return []
    if limit < 1:
        raise ValueError("limit must be positive.")

    passages = load_product_passages(directory)
    document_frequency = {
        term: sum(term in passage.terms for passage in passages)
        for term in query_terms
    }
    rare_query_terms = {
        term for term, frequency in document_frequency.items()
        if frequency <= 2
    }
    ranked: list[tuple[float, Passage]] = []
    total = len(passages)
    for passage in passages:
        overlap = query_terms & passage.terms
        if not overlap:
            continue
        if rare_query_terms and not rare_query_terms.intersection(overlap):
            continue
        score = sum(
            math.log1p((total - document_frequency[term] + 0.5) / (document_frequency[term] + 0.5))
            for term in overlap
        )
        ranked.append((score, passage))
    ranked.sort(key=lambda item: (-item[0], item[1].source))
    if not ranked:
        return []
    best_score = ranked[0][0]
    return [
        passage
        for score, passage in ranked
        if score >= best_score * 0.45
    ][:limit]


def format_product_doc_results(query: str) -> str:
    passages = search_product_docs(query)
    if not passages:
        return "NO_MATCH: The product docs contain no relevant passage for this question. Do not guess."
    sources: set[str] = set()
    excerpts_list = []
    for passage in passages:
        if passage.source in sources:
            continue
        sources.add(passage.source)
        excerpts_list.append(
            f"Source: docs/product/{passage.source} — {passage.title}\n{passage.text}"
        )
    excerpts = "\n".join(excerpts_list)
    return f"Retrieved product-doc passages:\n{excerpts}"
