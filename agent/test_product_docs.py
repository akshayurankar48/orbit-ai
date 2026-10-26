from pathlib import Path

import pytest

from product_docs import format_product_doc_results, search_product_docs

DOCS = Path(__file__).resolve().parent.parent / "docs" / "product"


def test_retrieval_finds_test_workspace_fact_and_citation() -> None:
    passages = search_product_docs("What's Juniper and Finch Studio's workspace code?")

    assert passages
    assert passages[0].source == "07-rag-test-workspace.md"
    assert "MINT-42" in passages[0].text
    assert "Source: docs/product/07-rag-test-workspace.md" in format_product_doc_results(
        "What's Juniper and Finch Studio's workspace code?"
    )


def test_retrieval_finds_second_fixture_and_answers_distinct_queries() -> None:
    owner = search_product_docs("Who owns the Moonlight Catalog project?")
    launch = search_product_docs("When is the Moonlight Catalog launch?")
    budget = search_product_docs("What is the sample budget for Moonlight Catalog?")

    assert owner[0].source == "08-rag-test-project.md"
    assert "Mara Vale" in owner[0].text
    assert all(passage.source != "04-roles.md" for passage in owner)
    assert "May 14" in launch[0].text
    assert "3,400 demo credits" in budget[0].text


def test_generic_owner_question_retrieves_role_document() -> None:
    passages = search_product_docs("What responsibilities does the Owner role have?")

    assert passages
    assert passages[0].source == "04-roles.md"
    assert "responsible for the workspace" in passages[0].text


def test_unmatched_question_does_not_return_unrelated_documents() -> None:
    query = "Which project won the 2040 moon cheese championship?"
    assert search_product_docs(query) == []
    assert format_product_doc_results(query).startswith(
        "NO_MATCH:"
    )


def test_empty_document_directory_is_reported(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="No product documentation"):
        search_product_docs("workspace setup", directory=tmp_path)
