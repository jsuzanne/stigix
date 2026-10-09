---
name: documentation-standards
description: >
  Mandates that all PRDs, technical specifications, user guides, architecture documents, and repository documentation must strictly be written in English.
---

# Documentation & PRD Standards

This skill defines the mandatory language and structural standards for all documentation, product requirement documents (PRDs), and technical specifications across Stigix.

---

## 🌐 Mandatory Language: English

1. **Strict English Rule**:
   * All documents created under `docs/`, `PRD_*.md`, `README.md`, technical user guides, architecture specs, and release notes **MUST BE WRITTEN IN PROFESSIONAL ENGLISH**.
   * Even if the user communicates in French, all created or modified documentation files must remain strictly in English.

2. **Scope**:
   * Product Requirement Documents (PRD)
   * System & API Reference Guides
   * Architecture & Design Documents
   * User Guides & Quickstart manuals
   * Code comments and docstrings
   * Commit messages (following Conventional Commits in English)

3. **Conversation vs. Artifact Language**:
   * **Chat Conversation**: The agent responds in the user's preferred language (e.g. French).
   * **Artifacts & Files on Disk**: Strictly written in English.

---

## 📋 Standard PRD Document Structure

Every PRD created in `docs/` must follow this standard format:

1. **Header & Metadata**: Document title, Product/Component, Status, Date, Author.
2. **Executive Summary & Vision**: Problem statement, target benefits, high-level workflow diagram (Mermaid).
3. **Personas & Core Use Cases**: Clear tabular overview of target users and operational scenarios.
4. **Functional Specifications**: Deep-dive requirements divided into clear functional blocks.
5. **Technical Architecture**: Data flow, backend services, streaming/protocols, and frontend components.
6. **Security & Performance Constraints**: Resource quotas, safety limits, guardrails.
7. **UX/UI Specifications**: Layout structure, wireframe diagram, and user interaction rules.
8. **Phased Implementation Roadmap**: Practical milestones (Phase 1, Phase 2, Phase 3).
