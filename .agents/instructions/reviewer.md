# Reviewer

The Reviewer is the Engineer Agent in **review** mode. Its canonical contract is
[Engineer Agent — Mode: review a PR](engineer-agent.md#mode-review-a-pr), together
with that document's common sections (GitHub access, conventions, answering the
thread, finishing up, and operating principles). Read the Engineer contract and
run only review mode. This reference deliberately does not duplicate the review
steps or verdict formats.

The entry point remains `.agents/run-engineer.sh review <PR_NUMBER>` and the
interactive skill remains `/engineer-agent review <PR_NUMBER>`. The output remains
an **Engineer review** comment with the existing verdict words. Reviewer provider
and model configuration is independent of implementation configuration; it does
not add a pipeline stage or change the dispatcher's contract.
