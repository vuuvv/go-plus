package parserfixture

import (
	"fmt"
	"testing"
)

// TestKeyedNameTable 覆盖最常见 keyed struct literal，case 名称来自 tt.name。
func TestKeyedNameTable(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty input", input: "", want: ""},
		{name: "regex .* chars", input: "a", want: "a"},
		{name: "url path /api/v1 [ok]", input: "b", want: "b"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.input != tt.want {
				t.Fatal("unexpected")
			}
		})
	}
}

// TestDescFieldTable 覆盖配置默认允许的 desc 字段，确保 detector 不只识别 name。
func TestDescFieldTable(t *testing.T) {
	tests := []struct {
		desc string
		in   int
	}{
		{desc: "zero", in: 0},
	}

	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			_ = tc.in
		})
	}
}

// TestPositionalTable 覆盖 positional struct literal，字段顺序来自 inline struct 定义。
func TestPositionalTable(t *testing.T) {
	tests := []struct {
		title string
		in    int
	}{
		{"first positional", 1},
	}

	for _, item := range tests {
		t.Run(item.title, func(t *testing.T) {
			_ = item.in
		})
	}
}

// TestInlineTable 覆盖 range 表达式中的 inline table literal。
func TestInlineTable(t *testing.T) {
	for _, tt := range []struct {
		caseName string
	}{
		{caseName: "inline case"},
	} {
		t.Run(tt.caseName, func(t *testing.T) {})
	}
}

// TestMapTable 覆盖以 string map key 作为 subtest 名称的 table。
func TestMapTable(t *testing.T) {
	tests := map[string]struct {
		input string
	}{
		"map key case": {input: "ok"},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			_ = tt.input
		})
	}
}

// TestDynamicNamesAreSkipped 覆盖动态名称和 helper 名称，detector 应安静跳过避免误导性入口。
func TestDynamicNamesAreSkipped(t *testing.T) {
	tests := []struct {
		name string
		in   int
	}{
		{name: "dynamic", in: 1},
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("%s-%d", tt.name, tt.in), func(t *testing.T) {})
		t.Run(dynamicCaseName(tt.name), func(t *testing.T) {})
	}
}

func dynamicCaseName(name string) string {
	return name
}
