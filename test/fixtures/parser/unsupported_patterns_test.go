package parserfixture

import (
	"fmt"
	"testing"
)

// TestHelperReturnedTableIsSkipped 覆盖 helper 返回 table 的不支持模式。
// 当前 detector 只信任测试函数内部的静态 composite literal，避免跨函数数据流误判 case 名称。
func TestHelperReturnedTableIsSkipped(t *testing.T) {
	tests := helperReturnedCases()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_ = tt.input
		})
	}
}

// TestVariableBackedEntryNameIsSkipped 覆盖 table entry 名称来自变量的场景。
// 即使变量在源码附近，当前阶段也不做常量传播，因此不会显示可能失真的 Run Case。
func TestVariableBackedEntryNameIsSkipped(t *testing.T) {
	name := "variable case"
	tests := []struct {
		name string
	}{
		{name: name},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {})
	}
}

// TestAliasedRunNameIsSkipped 覆盖循环中把 tt.name 赋给局部变量后再传给 t.Run。
// 这个模式需要额外数据流分析，里程碑 4 先保持安全跳过。
func TestAliasedRunNameIsSkipped(t *testing.T) {
	tests := []struct {
		name string
	}{
		{name: "aliased"},
	}

	for _, tt := range tests {
		caseName := tt.name
		t.Run(caseName, func(t *testing.T) {})
	}
}

// TestFormattedMapKeyIsSkipped 覆盖 map key 不是静态字符串字面量的场景。
// map-based table 仅支持字面量 string key，动态 key 不会生成 case 入口。
func TestFormattedMapKeyIsSkipped(t *testing.T) {
	prefix := "map"
	tests := map[string]struct{}{
		fmt.Sprintf("%s key", prefix): {},
	}

	for name := range tests {
		t.Run(name, func(t *testing.T) {})
	}
}

func helperReturnedCases() []struct {
	name  string
	input string
} {
	return []struct {
		name  string
		input string
	}{
		{name: "from helper", input: "x"},
	}
}
