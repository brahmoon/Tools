export const NodeLibrary = [
  {
    id: 'excel_bootstrap',
    category: 'Excel',
    label: 'Excel Application',
    inputs: [],
    outputs: ['ExcelApp'],
    controls: [
      {
        key: 'visible',
        label: 'Visible',
        type: 'select',
        options: [
          { value: '$true', label: 'True' },
          { value: '$false', label: 'False' },
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
    id: 'workbook_open',
    category: 'Excel',
    label: 'Open Workbook',
    inputs: ['ExcelApp', 'FilePath'],
    outputs: ['Workbook'],
    controls: [
      {
        key: 'filepath',
        label: 'File path',
        type: 'text',
        placeholder: String.raw`C:\Data\report.xlsx`,
        default: '',
        bindsToInput: 'FilePath',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const literalPath = config.filepath?.trim();
      if (literalPath) {
        const escaped = literalPath.replace(/`/g, '``').replace(/"/g, '""');
        return `${outputs.Workbook} = ${inputs.ExcelApp}.Workbooks.Open(\"${escaped}\")`;
      }
      return `${outputs.Workbook} = ${inputs.ExcelApp}.Workbooks.Open(${inputs.FilePath})`;
    },
  },
  {
    id: 'sheet_select',
    category: 'Excel',
    label: 'Select Sheet',
    inputs: ['Workbook', 'SheetName'],
    outputs: ['Sheet'],
    controls: [
      {
        key: 'sheet',
        label: 'Sheet name',
        type: 'text',
        placeholder: 'Sheet1',
        default: 'Sheet1',
        bindsToInput: 'SheetName',
      },
    ],
    script: ({ inputs, outputs, config }) => {
      const literal = config.sheet?.trim();
      if (literal) {
        const escaped = literal.replace(/`/g, '``').replace(/"/g, '""');
        return `${outputs.Sheet} = ${inputs.Workbook}.Sheets.Item(\"${escaped}\")`;
      }
      return `${outputs.Sheet} = ${inputs.Workbook}.Sheets.Item(${inputs.SheetName})`;
    },
  },
  {
    id: 'range_used',
    category: 'Range',
    label: 'Used Range',
    inputs: ['Sheet'],
    outputs: ['Range'],
    controls: [],
    script: ({ inputs, outputs }) => `${outputs.Range} = ${inputs.Sheet}.UsedRange`,
  },
  {
    id: 'filter_numeric',
    category: 'Range',
    label: 'Filter Numeric',
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
    id: 'highlight_cells',
    category: 'Range',
    label: 'Highlight Cells',
    inputs: ['Cells'],
    outputs: ['Cells'],
    controls: [
      {
        key: 'colorIndex',
        label: 'Color Index',
        type: 'number',
        default: '6',
      },
    ],
    script: ({ inputs, outputs, config }) =>
      [
        `${inputs.Cells} | ForEach-Object { $_.Interior.ColorIndex = ${config.colorIndex || '6'} }`,
        `${outputs.Cells} = ${inputs.Cells}`,
      ].join('\n'),
  },
  {
    id: 'workbook_save',
    category: 'Excel',
    label: 'Save & Close',
    inputs: ['Workbook', 'ExcelApp'],
    outputs: ['Workbook'],
    controls: [],
    script: ({ inputs, outputs }) =>
      [
        `${inputs.Workbook}.Save()`,
        `${inputs.Workbook}.Close()`,
        `${inputs.ExcelApp}.Quit()`,
        `${outputs.Workbook} = ${inputs.Workbook}`,
      ].join('\n'),
  },
];
