const psString = (value, fallback = '') => {
  const raw = value ?? fallback;
  if (raw === undefined || raw === null || raw === '') {
    return '""';
  }
  const str = String(raw);
  const escaped = str.replace(/`/g, '``').replace(/"/g, '""');
  return `"${escaped}"`;
};

const boolOption = (value, label) => ({ value, label });

export const NodeLibrary = [
  // File nodes
  {
    id: 'excel_bootstrap',
    category: 'File',
    label: 'Excel Application',
    inputs: [],
    outputs: ['ExcelApp'],
    controls: [
      {
        key: 'visible',
        label: 'Visible',
        type: 'select',
        options: [
          boolOption('$true', 'True'),
          boolOption('$false', 'False'),
        ],
        default: '$false',
      },
    ],
    script: ({ outputs, config }) =>
      [
        `${outputs.ExcelApp} = New-Object -ComObject Excel.Application`,
        `${outputs.ExcelApp}.Visible = ${config.visible || '$false'}`,
      ].join('\n'),
  },
  {
    id: 'file_input',
    category: 'File',
    label: 'File Input',
    inputs: [],
    outputs: ['FilePath', 'FileInfo', 'FileList'],
    controls: [
      {
        key: 'path',
        label: 'Path',
        type: 'text',
        placeholder: String.raw`C:\Data\report.xlsx`,
        default: String.raw`C:\Data\report.xlsx`,
      },
    ],
    script: ({ outputs, config }) => {
      const literal = psString(config.path, String.raw`C:\Data\report.xlsx`);
      return [
        `${outputs.FilePath} = ${literal}`,
        `${outputs.FileInfo} = Get-Item -LiteralPath ${outputs.FilePath}`,
        `${outputs.FileList} = @(${outputs.FileInfo})`,
      ].join('\n');
    },
  },
  {
    id: 'file_filter',
    category: 'File',
    label: 'File Filter',
    inputs: ['FileList'],
    outputs: ['FileList'],
    controls: [
      {
        key: 'pattern',
        label: 'Pattern',
        type: 'text',
        placeholder: '*.xlsx',
        default: '*.xlsx',
      },
      {
        key: 'includeHidden',
        label: 'Include Hidden',
        type: 'select',
        options: [boolOption('$true', 'Yes'), boolOption('$false', 'No')],
        default: '$false',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const pattern = psString(config.pattern, '*.xlsx');
      const hidden = config.includeHidden === '$true' ? '$true' : '$false';
      return [
        `${outputs.FileList} = ${inputs.FileList} | Where-Object {`,
        `  $_.Name -like ${pattern} -and ((${hidden}) -or -not $_.Attributes.HasFlag([System.IO.FileAttributes]::Hidden))`,
        `}`,
      ].join('\n');
    },
  },
  {
    id: 'file_visibility',
    category: 'File',
    label: 'File Visibility',
    inputs: ['ExcelApp'],
    outputs: ['ExcelApp'],
    controls: [
      {
        key: 'visible',
        label: 'Visible',
        type: 'select',
        options: [boolOption('$true', 'True'), boolOption('$false', 'False')],
        default: '$true',
      },
    ],
    script: ({ inputs, outputs, config }) => [
      `${inputs.ExcelApp}.Visible = ${config.visible || '$true'}`,
      `${outputs.ExcelApp} = ${inputs.ExcelApp}`,
    ].join('\n'),
  },
  {
    id: 'file_save_export',
    category: 'File',
    label: 'File Save / Export',
    inputs: ['Workbook', 'Range', 'FilePath'],
    outputs: ['Workbook'],
    controls: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        options: [
          { value: 'save', label: 'Save' },
          { value: 'saveAs', label: 'Save As' },
          { value: 'exportCsv', label: 'Export CSV' },
          { value: 'exportExcel', label: 'Export Excel (xlsx)' },
        ],
        default: 'save',
      },
      {
        key: 'filePath',
        label: 'Destination path',
        type: 'text',
        placeholder: String.raw`C:\Data\output.xlsx`,
        default: String.raw`C:\Data\output.xlsx`,
        bindsToInput: 'FilePath',
      },
      {
        key: 'rangeFallback',
        label: 'Range variable (for export)',
        type: 'text',
        placeholder: '$range_used_Range',
        default: '$null',
        bindsToInput: 'Range',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const mode = config.mode || 'save';
      const workbook = inputs.Workbook;
      const filePath = inputs.FilePath && inputs.FilePath !== '' ? inputs.FilePath : psString(config.filePath);
      const rangeRef = inputs.Range && inputs.Range !== '' ? inputs.Range : config.rangeFallback || '$null';

      if (!workbook) {
        throw new Error('File Save / Export requires a Workbook input.');
      }

      const lines = [];
      switch (mode) {
        case 'save':
          lines.push(`${workbook}.Save()`);
          break;
        case 'saveAs':
          lines.push(`${workbook}.SaveAs(${filePath})`);
          break;
        case 'exportCsv':
          lines.push(`if (${rangeRef} -eq $null) { throw 'Export CSV requires a Range input.' }`);
          lines.push(`$__rows = @()`);
          lines.push(`foreach ($row in @(${rangeRef}.Value2)) {`);
          lines.push(`  if ($row -is [System.Array]) {`);
          lines.push(`    $__rows += [PSCustomObject]@{ Values = ($row -join ',') }`);
          lines.push(`  } elseif ($row) {`);
          lines.push(`    $__rows += [PSCustomObject]@{ Values = $row }`);
          lines.push(`  }`);
          lines.push(`}`);
          lines.push(`$__rows | Export-Csv -NoTypeInformation -Path ${filePath}`);
          break;
        case 'exportExcel':
          lines.push(`${workbook}.SaveAs(${filePath}, 51)`);
          break;
        default:
          lines.push(`# Unsupported mode: ${mode}`);
      }
      lines.push(`${outputs.Workbook} = ${workbook}`);
      return lines.join('\n');
    },
  },

  // Workbook nodes
  {
    id: 'workbook_open',
    category: 'Workbook',
    label: 'Workbook Open',
    inputs: ['ExcelApp', 'FilePath'],
    outputs: ['Workbook'],
    controls: [
      {
        key: 'path',
        label: 'File path',
        type: 'text',
        placeholder: String.raw`C:\Data\report.xlsx`,
        default: String.raw`C:\Data\report.xlsx`,
        bindsToInput: 'FilePath',
      },
      {
        key: 'readonly',
        label: 'Read only',
        type: 'select',
        options: [boolOption('$true', 'True'), boolOption('$false', 'False')],
        default: '$false',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const path = inputs.FilePath && inputs.FilePath !== '' ? inputs.FilePath : psString(config.path);
      const readOnly = config.readonly === '$true' ? '$true' : '$false';
      return `${outputs.Workbook} = ${inputs.ExcelApp}.Workbooks.Open(${path}, 0, ${readOnly})`;
    },
  },
  {
    id: 'workbook_create',
    category: 'Workbook',
    label: 'Workbook Create',
    inputs: ['ExcelApp'],
    outputs: ['Workbook'],
    controls: [
      {
        key: 'template',
        label: 'Template path (optional)',
        type: 'text',
        placeholder: String.raw`C:\Templates\base.xlsx`,
        default: '',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const template = config.template?.trim();
      if (template) {
        return `${outputs.Workbook} = ${inputs.ExcelApp}.Workbooks.Add(${psString(template)})`;
      }
      return `${outputs.Workbook} = ${inputs.ExcelApp}.Workbooks.Add()`;
    },
  },
  {
    id: 'workbook_close',
    category: 'Workbook',
    label: 'Workbook Close',
    inputs: ['Workbook'],
    outputs: ['Workbook'],
    controls: [
      {
        key: 'saveChanges',
        label: 'Save changes',
        type: 'select',
        options: [
          { value: 'save', label: 'Save before closing' },
          { value: 'discard', label: 'Discard changes' },
        ],
        default: 'save',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const lines = [];
      if (config.saveChanges === 'save') {
        lines.push(`${inputs.Workbook}.Save()`);
        lines.push(`${inputs.Workbook}.Close()`);
      } else {
        lines.push(`${inputs.Workbook}.Close($false)`);
      }
      lines.push(`${outputs.Workbook} = ${inputs.Workbook}`);
      return lines.join('\n');
    },
  },
  {
    id: 'workbook_list_sheets',
    category: 'Workbook',
    label: 'Workbook ListSheets',
    inputs: ['Workbook'],
    outputs: ['SheetNames'],
    controls: [],
    script: ({ inputs, outputs }) =>
      `${outputs.SheetNames} = @(${inputs.Workbook}.Worksheets | ForEach-Object { $_.Name })`,
  },
  {
    id: 'workbook_activate',
    category: 'Workbook',
    label: 'Workbook Activate',
    inputs: ['Workbook'],
    outputs: ['Workbook'],
    controls: [],
    script: ({ inputs, outputs }) => [
      `${inputs.Workbook}.Activate()`,
      `${outputs.Workbook} = ${inputs.Workbook}`,
    ].join('\n'),
  },

  // Sheet nodes
  {
    id: 'sheet_select',
    category: 'Sheet',
    label: 'Sheet Select',
    inputs: ['Workbook', 'SheetName', 'SheetIndex'],
    outputs: ['Sheet'],
    controls: [
      {
        key: 'mode',
        label: 'Select by',
        type: 'select',
        options: [
          { value: 'name', label: 'Name' },
          { value: 'index', label: 'Index' },
        ],
        default: 'name',
      },
      {
        key: 'sheet',
        label: 'Sheet name',
        type: 'text',
        placeholder: 'Sheet1',
        default: 'Sheet1',
        bindsToInput: 'SheetName',
      },
      {
        key: 'index',
        label: 'Sheet index',
        type: 'number',
        default: '1',
        bindsToInput: 'SheetIndex',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const mode = config.mode || 'name';
      if (mode === 'index') {
        return `${outputs.Sheet} = ${inputs.Workbook}.Sheets.Item(${inputs.SheetIndex || config.index || '1'})`;
      }
      const raw = inputs.SheetName && inputs.SheetName !== '' ? inputs.SheetName : config.sheet;
      const name = raw && raw.startsWith('$') ? raw : psString(raw || 'Sheet1');
      return `${outputs.Sheet} = ${inputs.Workbook}.Sheets.Item(${name})`;
    },
  },
  {
    id: 'sheet_add',
    category: 'Sheet',
    label: 'Sheet Add',
    inputs: ['Workbook'],
    outputs: ['Sheet'],
    controls: [
      {
        key: 'name',
        label: 'Sheet name',
        type: 'text',
        placeholder: 'Summary',
        default: '',
      },
      {
        key: 'position',
        label: 'Position',
        type: 'select',
        options: [
          { value: 'end', label: 'End' },
          { value: 'begin', label: 'Beginning' },
        ],
        default: 'end',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const position = config.position === 'begin' ? `${inputs.Workbook}.Sheets.Item(1)` : '';
      const addLine = position
        ? `${outputs.Sheet} = ${inputs.Workbook}.Worksheets.Add(${position})`
        : `${outputs.Sheet} = ${inputs.Workbook}.Worksheets.Add()`;
      const lines = [addLine];
      if (config.name?.trim()) {
        lines.push(`${outputs.Sheet}.Name = ${psString(config.name.trim())}`);
      }
      return lines.join('\n');
    },
  },
  {
    id: 'sheet_rename',
    category: 'Sheet',
    label: 'Sheet Rename',
    inputs: ['Sheet', 'NewName'],
    outputs: ['Sheet'],
    controls: [
      {
        key: 'newName',
        label: 'New name',
        type: 'text',
        placeholder: 'Summary',
        default: 'Summary',
        bindsToInput: 'NewName',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const raw = inputs.NewName && inputs.NewName !== '' ? inputs.NewName : config.newName;
      const newName = raw && raw.startsWith('$') ? raw : psString(raw || 'Summary');
      return [
        `${inputs.Sheet}.Name = ${newName}`,
        `${outputs.Sheet} = ${inputs.Sheet}`,
      ].join('\n');
    },
  },
  {
    id: 'sheet_delete',
    category: 'Sheet',
    label: 'Sheet Delete',
    inputs: ['Sheet'],
    outputs: ['Sheet'],
    controls: [],
    script: ({ inputs, outputs }) => [
      `${inputs.Sheet}.Delete()`,
      `${outputs.Sheet} = ${inputs.Sheet}`,
    ].join('\n'),
  },
  {
    id: 'sheet_copy_to',
    category: 'Sheet',
    label: 'Sheet CopyTo',
    inputs: ['Sheet', 'TargetWorkbook'],
    outputs: ['Sheet'],
    controls: [],
    script: ({ inputs, outputs }) => {
      const lines = [];
      lines.push(`${inputs.Sheet}.Copy($null, ${inputs.TargetWorkbook}.Sheets.Item(${inputs.TargetWorkbook}.Sheets.Count))`);
      lines.push(`${outputs.Sheet} = ${inputs.TargetWorkbook}.ActiveSheet`);
      return lines.join('\n');
    },
  },
  {
    id: 'sheet_activate',
    category: 'Sheet',
    label: 'Sheet Activate',
    inputs: ['Sheet'],
    outputs: ['Sheet'],
    controls: [],
    script: ({ inputs, outputs }) => [
      `${inputs.Sheet}.Activate()`,
      `${outputs.Sheet} = ${inputs.Sheet}`,
    ].join('\n'),
  },
  {
    id: 'sheet_property',
    category: 'Sheet',
    label: 'Sheet Property',
    inputs: ['Sheet'],
    outputs: ['Sheet', 'PropertyValue'],
    controls: [
      {
        key: 'property',
        label: 'Property',
        type: 'select',
        options: [
          { value: 'Name', label: 'Name' },
          { value: 'Index', label: 'Index' },
          { value: 'Visible', label: 'Visible' },
          { value: 'Tab.Color', label: 'Tab Color' },
        ],
        default: 'Name',
      },
      {
        key: 'setValue',
        label: 'Set value (optional)',
        type: 'text',
        placeholder: 'Hidden',
        default: '',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const lines = [];
      const property = config.property || 'Name';
      if (config.setValue?.trim()) {
        if (property === 'Visible') {
          const visible = config.setValue === '$true' ? '$true' : config.setValue === '$false' ? '$false' : config.setValue;
          lines.push(`${inputs.Sheet}.Visible = ${visible}`);
        } else if (property === 'Tab.Color') {
          lines.push(`${inputs.Sheet}.Tab.Color = ${config.setValue}`);
        } else {
          lines.push(`${inputs.Sheet}.${property} = ${psString(config.setValue.trim())}`);
        }
      }
      if (property === 'Tab.Color') {
        lines.push(`${outputs.PropertyValue} = ${inputs.Sheet}.Tab.Color`);
      } else {
        lines.push(`${outputs.PropertyValue} = ${inputs.Sheet}.${property}`);
      }
      lines.push(`${outputs.Sheet} = ${inputs.Sheet}`);
      return lines.join('\n');
    },
  },
  {
    id: 'sheet_used_range',
    category: 'Sheet',
    label: 'Sheet UsedRange',
    inputs: ['Sheet'],
    outputs: ['Range'],
    controls: [],
    script: ({ inputs, outputs }) => `${outputs.Range} = ${inputs.Sheet}.UsedRange`,
  },
  {
    id: 'sheet_print_area',
    category: 'Sheet',
    label: 'Sheet PrintArea',
    inputs: ['Sheet'],
    outputs: ['Range'],
    controls: [],
    script: ({ inputs, outputs }) => [
      `$__printAddress = ${inputs.Sheet}.PageSetup.PrintArea`,
      `if (-not $__printAddress) { throw 'PrintArea is not defined for the sheet.' }`,
      `${outputs.Range} = ${inputs.Sheet}.Range($__printAddress)`,
    ].join('\n'),
  },

  // Range nodes
  {
    id: 'range_select',
    category: 'Range',
    label: 'Range Select',
    inputs: ['Sheet', 'Address'],
    outputs: ['Range', 'Cell'],
    controls: [
      {
        key: 'address',
        label: 'Address',
        type: 'text',
        placeholder: 'A1:B10',
        default: 'A1',
        bindsToInput: 'Address',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const addr = inputs.Address && inputs.Address !== '' ? inputs.Address : config.address;
      const address = addr && addr.startsWith('$') ? addr : psString(addr || 'A1');
      return [
        `${outputs.Range} = ${inputs.Sheet}.Range(${address})`,
        `${outputs.Cell} = ${outputs.Range}`,
      ].join('\n');
    },
  },
  {
    id: 'range_union',
    category: 'Range',
    label: 'Range Union',
    inputs: ['RangeA', 'RangeB'],
    outputs: ['Range'],
    controls: [],
    script: ({ inputs, outputs }) =>
      `${outputs.Range} = ${inputs.RangeA}.Application.Union(${inputs.RangeA}, ${inputs.RangeB})`,
  },
  {
    id: 'range_intersect',
    category: 'Range',
    label: 'Range Intersect',
    inputs: ['RangeA', 'RangeB'],
    outputs: ['Range'],
    controls: [],
    script: ({ inputs, outputs }) =>
      `${outputs.Range} = ${inputs.RangeA}.Application.Intersect(${inputs.RangeA}, ${inputs.RangeB})`,
  },
  {
    id: 'range_copy',
    category: 'Range',
    label: 'Range Copy',
    inputs: ['SourceRange', 'TargetRange'],
    outputs: ['TargetRange'],
    controls: [],
    script: ({ inputs, outputs }) => [
      `${inputs.SourceRange}.Copy(${inputs.TargetRange})`,
      `${outputs.TargetRange} = ${inputs.TargetRange}`,
    ].join('\n'),
  },
  {
    id: 'range_paste',
    category: 'Range',
    label: 'Range Paste',
    inputs: ['TargetRange'],
    outputs: ['TargetRange'],
    controls: [
      {
        key: 'pasteType',
        label: 'Paste type',
        type: 'select',
        options: [
          { value: '-4104', label: 'All' },
          { value: '-4163', label: 'Values' },
          { value: '-4122', label: 'Formats' },
        ],
        default: '-4104',
      },
    ],
    script: ({ inputs, outputs, config }) => [
      `${inputs.TargetRange}.PasteSpecial(${config.pasteType || '-4104'})`,
      `${outputs.TargetRange} = ${inputs.TargetRange}`,
    ].join('\n'),
  },
  {
    id: 'range_clear',
    category: 'Range',
    label: 'Range Clear',
    inputs: ['Range'],
    outputs: ['Range'],
    controls: [
      {
        key: 'clearType',
        label: 'Clear',
        type: 'select',
        options: [
          { value: 'Clear', label: 'All' },
          { value: 'ClearContents', label: 'Contents' },
          { value: 'ClearFormats', label: 'Formats' },
        ],
        default: 'ClearContents',
      },
    ],
    script: ({ inputs, outputs, config }) => [
      `${inputs.Range}.${config.clearType || 'ClearContents'}()`,
      `${outputs.Range} = ${inputs.Range}`,
    ].join('\n'),
  },
  {
    id: 'range_find_replace',
    category: 'Range',
    label: 'Range Find / Replace',
    inputs: ['Range'],
    outputs: ['Range', 'Matches'],
    controls: [
      {
        key: 'find',
        label: 'Find text',
        type: 'text',
        placeholder: 'Keyword',
        default: 'Keyword',
      },
      {
        key: 'replace',
        label: 'Replace with',
        type: 'text',
        placeholder: '(optional)',
        default: '',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const findValue = psString(config.find, 'Keyword');
      const replaceValue = config.replace?.trim() ? psString(config.replace.trim()) : '""';
      return [
        `$__match = ${inputs.Range}.Find(${findValue})`,
        `${outputs.Matches} = @()`,
        `while ($__match) {`,
        `  ${outputs.Matches} += $__match`,
        `  if (${replaceValue} -ne "") { $__match.Value2 = ${replaceValue} }`,
        `  $__match = ${inputs.Range}.FindNext($__match)`,
        `}`,
        `${outputs.Range} = ${inputs.Range}`,
      ].join('\n');
    },
  },
  {
    id: 'range_diff',
    category: 'Range',
    label: 'Range Diff',
    inputs: ['FirstRange', 'SecondRange'],
    outputs: ['Differences'],
    controls: [],
    script: ({ inputs, outputs }) => [
      `$__first = @(${inputs.FirstRange}.Value2)`,
      `$__second = @(${inputs.SecondRange}.Value2)`,
      `${outputs.Differences} = Compare-Object -ReferenceObject $__first -DifferenceObject $__second`,
    ].join('\n'),
  },
  {
    id: 'range_format',
    category: 'Range',
    label: 'Range Format',
    inputs: ['Range'],
    outputs: ['Range'],
    controls: [
      {
        key: 'background',
        label: 'Background color index',
        type: 'number',
        default: '6',
      },
      {
        key: 'fontColor',
        label: 'Font color index',
        type: 'number',
        default: '',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const lines = [];
      if (config.background) {
        lines.push(`${inputs.Range}.Interior.ColorIndex = ${config.background}`);
      }
      if (config.fontColor) {
        lines.push(`${inputs.Range}.Font.ColorIndex = ${config.fontColor}`);
      }
      lines.push(`${outputs.Range} = ${inputs.Range}`);
      return lines.join('\n');
    },
  },
  {
    id: 'range_filter_numeric',
    category: 'Range',
    label: 'Range Filter Numeric',
    inputs: ['Range'],
    outputs: ['FilteredCells'],
    controls: [
      {
        key: 'operator',
        label: 'Operator',
        type: 'select',
        options: [
          { value: '-gt', label: '>' },
          { value: '-ge', label: '≥' },
          { value: '-lt', label: '<' },
          { value: '-le', label: '≤' },
          { value: '-eq', label: '=' },
        ],
        default: '-gt',
      },
      {
        key: 'value',
        label: 'Value',
        type: 'number',
        default: '0',
      },
    ],
    script: ({ inputs, outputs, config }) =>
      `${outputs.FilteredCells} = ${inputs.Range}.Cells | Where-Object { $_.Value2 ${config.operator || '-gt'} ${config.value || '0'} }`,
  },
  {
    id: 'range_highlight',
    category: 'Range',
    label: 'Range Highlight Cells',
    inputs: ['Cells'],
    outputs: ['Cells'],
    controls: [
      {
        key: 'colorIndex',
        label: 'Color index',
        type: 'number',
        default: '6',
      },
    ],
    script: ({ inputs, outputs, config }) => [
      `${inputs.Cells} | ForEach-Object { $_.Interior.ColorIndex = ${config.colorIndex || '6'} }`,
      `${outputs.Cells} = ${inputs.Cells}`,
    ].join('\n'),
  },

  // Cell nodes
  {
    id: 'cell_get_value',
    category: 'Cell',
    label: 'Cell GetValue',
    inputs: ['Cell'],
    outputs: ['Value'],
    controls: [],
    script: ({ inputs, outputs }) => `${outputs.Value} = ${inputs.Cell}.Value2`,
  },
  {
    id: 'cell_set_value',
    category: 'Cell',
    label: 'Cell SetValue',
    inputs: ['Cell', 'Value'],
    outputs: ['Cell'],
    controls: [
      {
        key: 'value',
        label: 'Value',
        type: 'text',
        placeholder: '42',
        default: '42',
        bindsToInput: 'Value',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const raw = inputs.Value && inputs.Value !== '' ? inputs.Value : config.value;
      const value = raw && raw.startsWith('$') ? raw : psString(raw || '');
      return [
        `${inputs.Cell}.Value2 = ${value}`,
        `${outputs.Cell} = ${inputs.Cell}`,
      ].join('\n');
    },
  },
  {
    id: 'cell_color',
    category: 'Cell',
    label: 'Cell Color / Interior',
    inputs: ['Cell'],
    outputs: ['Cell'],
    controls: [
      {
        key: 'interior',
        label: 'Interior color index',
        type: 'number',
        default: '6',
      },
      {
        key: 'font',
        label: 'Font color index',
        type: 'number',
        default: '',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const lines = [];
      if (config.interior) {
        lines.push(`${inputs.Cell}.Interior.ColorIndex = ${config.interior}`);
      }
      if (config.font) {
        lines.push(`${inputs.Cell}.Font.ColorIndex = ${config.font}`);
      }
      lines.push(`${outputs.Cell} = ${inputs.Cell}`);
      return lines.join('\n');
    },
  },
  {
    id: 'cell_formula',
    category: 'Cell',
    label: 'Cell Formula',
    inputs: ['Cell', 'Formula'],
    outputs: ['Cell'],
    controls: [
      {
        key: 'formula',
        label: 'Formula',
        type: 'text',
        placeholder: '=SUM(A1:A10)',
        default: '=SUM(A1:A10)',
        bindsToInput: 'Formula',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const raw = inputs.Formula && inputs.Formula !== '' ? inputs.Formula : config.formula;
      const formula = raw && raw.startsWith('$') ? raw : psString(raw || '=SUM(A1:A10)');
      return [
        `${inputs.Cell}.Formula = ${formula}`,
        `${outputs.Cell} = ${inputs.Cell}`,
      ].join('\n');
    },
  },
  {
    id: 'cell_merge',
    category: 'Cell',
    label: 'Cell Merge / Unmerge',
    inputs: ['Cell'],
    outputs: ['Cell'],
    controls: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        options: [
          { value: 'merge', label: 'Merge' },
          { value: 'unmerge', label: 'Unmerge' },
        ],
        default: 'merge',
      },
      {
        key: 'across',
        label: 'Merge across',
        type: 'select',
        options: [boolOption('$true', 'True'), boolOption('$false', 'False')],
        default: '$false',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      if (config.mode === 'unmerge') {
        return [
          `${inputs.Cell}.UnMerge()`,
          `${outputs.Cell} = ${inputs.Cell}`,
        ].join('\n');
      }
      const across = config.across === '$true' ? '$true' : '$false';
      return [
        `${inputs.Cell}.Merge(${across})`,
        `${outputs.Cell} = ${inputs.Cell}`,
      ].join('\n');
    },
  },
  {
    id: 'cell_comment',
    category: 'Cell',
    label: 'Cell Comment',
    inputs: ['Cell'],
    outputs: ['Cell'],
    controls: [
      {
        key: 'comment',
        label: 'Comment text',
        type: 'text',
        placeholder: 'Note',
        default: 'Note',
      },
      {
        key: 'clear',
        label: 'Clear existing',
        type: 'select',
        options: [boolOption('$true', 'Yes'), boolOption('$false', 'No')],
        default: '$false',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const lines = [];
      if (config.clear === '$true') {
        lines.push(`if (${inputs.Cell}.Comment) { ${inputs.Cell}.Comment.Delete() }`);
      }
      if (config.comment?.trim()) {
        lines.push(`${inputs.Cell}.AddComment(${psString(config.comment.trim())})`);
      }
      lines.push(`${outputs.Cell} = ${inputs.Cell}`);
      return lines.join('\n');
    },
  },
];
