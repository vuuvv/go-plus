# Go Plus

Go Plus is a VSCode extension that improves Go table-driven test workflows.
It adds editor run entries for whole Go test functions and resolvable table
test cases, so you can run a single case without rewriting code or manually
assembling `go test -run` patterns.

## Features

- Shows `Run Test` CodeLens entries for Go `TestXxx` functions.
- Shows `Run Case` CodeLens entries for table-driven cases with stable names.
- Builds standard `go test <package> -run <pattern>` commands and preserves the
  original `go test` output in the Go Plus output channel.
- Escapes regular expression characters in test and subtest names before running
  a targeted test.
- Supports configurable table case name fields, including `name`, `desc`,
  `caseName`, and `title` by default.
- Provides an experimental VSCode Testing API tree for discovered table tests.
- Adds a `Refresh Test Tree` CodeLens at the top of Go test files to refresh the
  current file in Test Explorer when the experimental tree is enabled.

Go Plus is designed to complement the official Go extension, not replace it.

## Requirements

- VSCode 1.90.0 or newer.
- The Go toolchain available on `PATH`.
- Go test files ending in `_test.go`.

## Supported Test Pattern

Go Plus focuses on common local table-driven tests:

```go
func TestNormalize(t *testing.T) {
	tests := []struct {
		name string
		input string
		want string
	}{
		{name: "empty", input: "", want: ""},
		{name: "simple", input: "a", want: "a"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// assertions
		})
	}
}
```

When a case name can be resolved safely, Go Plus shows a case-level run entry.
Dynamic names, helper-generated tables, and runtime-only data are intentionally
ignored instead of producing unreliable run buttons.

## Commands

- `Go Plus: Run Test`
- `Go Plus: Refresh Test Tree`
- `Go Plus: Refresh Current File Test Tree`
- `Go Plus: No-op`

## Configuration

```json
{
  "goPlus.tableTests.enabled": true,
  "goPlus.tableTests.nameFields": ["name", "desc", "caseName", "title"],
  "goPlus.tableTests.showFunctionRun": true,
  "goPlus.tableTests.showCaseRun": true,
  "goPlus.tableTests.testingApi.enabled": false
}
```

## Development

```sh
npm install
npm run compile
npm run lint
npm test
```

Use the `Run Go Plus Extension` launch configuration to start an Extension Development Host.

## Repository

https://github.com/vuuvv/go-plus

## License

MIT
