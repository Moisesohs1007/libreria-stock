$path = "e:/Asistencia QR/IA GEMINI/libreria/index.html"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$c = [System.IO.File]::ReadAllText($path, $utf8)

$rep = [string][char]0xFFFD
$c = $c.Replace($rep, "")

$c = [System.Text.RegularExpressions.Regex]::Replace($c, 'Y\"[^\s]*\s*', '')

$bullet = [char]0x2022
$emDash = [char]0x2014
$arrow  = [char]0x2192
$capU   = [char]0x00DA
$capO   = [char]0x00D3
$hamb   = [char]0x2630
$times  = [char]0x00D7
$leq    = [char]0x2264
$pwPh   = ($bullet.ToString() * 8)

$c = $c.Replace('????????', $pwPh)
$c = $c.Replace('?"', $emDash)
$c = $c.Replace('?''', $arrow)
$c = $c.Replace('~', $hamb)

$c = $c.Replace('sltimas', ($capU.ToString() + 'ltimas'))
$c = $c.Replace('sltimos', ($capU.ToString() + 'ltimos'))
$c = $c.Replace('sltima',  ($capU.ToString() + 'ltima'))

$c = $c.Replace('MENUs', ('MEN' + $capU + 'S'))

$c = $c.Replace('MENs ADMIN', ('MEN' + $capU + 'S ADMIN'))
$c = $c.Replace('CONFIGURACI"N', ('CONFIGURACI' + $capO + 'N'))
$c = $c.Replace(('CONFIGURACI' + $capU + 'N'), ('CONFIGURACI' + $capO + 'N'))
$c = $c.Replace(('Configuraci' + $capU + 'n'), ('Configuraci' + $capO + 'n'))

$c = [System.Text.RegularExpressions.Regex]::Replace($c, 'sT[^\p{L}0-9]+', '')
$c = [System.Text.RegularExpressions.Regex]::Replace($c, 's\p{Mn}+\s*', '')

$c = $c.Replace('>o.<', ('>' + $times + '<'))
$c = $c.Replace('Todo bien o.', 'Todo bien')
$c = $c.Replace('FONDO -', 'FONDO')
$c = $c.Replace('(?5 unidades)', ('(' + $leq + '5 unidades)'))

$c = $c.Replace('Todo bien ' + $times, 'Todo bien')

$c = [System.Text.RegularExpressions.Regex]::Replace($c, ">Y[^\p{L}0-9]+", ">")
$c = [System.Text.RegularExpressions.Regex]::Replace($c, "'Y[^\p{L}0-9]+", "'")
$c = [System.Text.RegularExpressions.Regex]::Replace($c, ">z\.\s+", ">")
$c = [System.Text.RegularExpressions.Regex]::Replace($c, "'z\.\s+", "'")

$c = $c.Replace("'Y' Caja'", "'Caja'")
$c = $c.Replace("'Y' Usuarios'", "'Usuarios'")

$opt = ('<option value=\"\">' + $emDash + ' Selecciona una persona ' + $emDash + '</option>')
$c = $c.Replace('<option value=\"\"> Selecciona una persona </option>', $opt)
$c = $c.Replace('<option value=\"\">\" Selecciona una persona \"</option>', $opt)
$c = $c.Replace('<option value=\"\">' + $emDash + ' Selecciona una persona ' + $emDash + '</option>', $opt)

[System.IO.File]::WriteAllText($path, $c, $utf8)
